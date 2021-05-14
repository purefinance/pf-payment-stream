//SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./interfaces/IPaymentStream.sol";

contract PaymentStream is Ownable, AccessControl, IPaymentStream {
  using SafeERC20 for IERC20;
  using Counters for Counters.Counter;

  Counters.Counter private _totalStreams;

  modifier onlyPayer(uint256 streamId) {
    require(msg.sender == streams[streamId].payer, "Not stream owner");
    _;
  }

  modifier onlyPayerOrDelegated(uint256 streamId) {
    require(
      msg.sender == streams[streamId].payer ||
        hasRole(keccak256(abi.encodePacked(streamId)), msg.sender),
      "Not stream owner/delegated"
    );
    _;
  }

  modifier onlyPayee(uint256 streamId) {
    require(msg.sender == streams[streamId].payee, "Not payee");
    _;
  }

  mapping(uint256 => Stream) public streams;
  mapping(address => AggregatorV3Interface) public supportedTokens; // token address => oracle address

  constructor() {
    // Start the counts at 1
    // the 0th stream is available to all

    _totalStreams.increment();
  }

  function _addToken(address tokenAddress, address oracleAddress) internal {
    require(oracleAddress != address(0), "Oracle address missing");

    AggregatorV3Interface oracle = AggregatorV3Interface(oracleAddress);

    supportedTokens[tokenAddress] = oracle;

    emit TokenAdded(tokenAddress, oracleAddress);
  }

  function addToken(address tokenAddress, address oracleAddress)
    external
    override
    onlyOwner
  {
    _addToken(tokenAddress, oracleAddress);
  }

  function getStream(uint256 streamId) public view returns (Stream memory) {
    return streams[streamId];
  }

  function getStreamsCount() external view override returns (uint256) {
    return _totalStreams.current();
  }

  function createStream(
    address payee,
    uint256 usdAmount,
    address token,
    address fundingAddress,
    uint256 endTime
  ) external override returns (uint256) {
    require(endTime > block.timestamp, "End time is in the past");
    require(payee != fundingAddress, "payee == fundingAddress");
    require(
      payee != address(0) && fundingAddress != address(0),
      "invalid payee or fundingAddress"
    );
    require(usdAmount > 0, "usdAmount == 0");
    require(
      address(supportedTokens[token]) != address(0),
      "Token not supported"
    );

    Stream memory stream;

    stream.payee = payee;
    stream.usdAmount = usdAmount;
    stream.token = token;
    stream.fundingAddress = fundingAddress;
    stream.payer = msg.sender;
    stream.paused = false;
    stream.startTime = block.timestamp;
    stream.secs = endTime - block.timestamp;
    stream.usdPerSec = usdAmount / stream.secs;
    stream.claimed = 0;

    uint256 streamId = _totalStreams.current();

    streams[streamId] = stream;

    bytes32 adminRole = keccak256(abi.encodePacked("admin", streamId));
    bytes32 pausableRole = keccak256(abi.encodePacked(streamId));

    // Payer is set as admin of "pausableRole", so he can grant and revoke the "pausable" role later on

    _setupRole(adminRole, msg.sender);
    _setRoleAdmin(pausableRole, adminRole);

    emit NewStream(streamId, msg.sender, payee, usdAmount);

    _totalStreams.increment();

    return streamId;
  }

  function delegatePausable(uint256 streamId, address delegate)
    external
    override
  {
    require(delegate != address(0), "Invalid delegate");

    grantRole(keccak256(abi.encodePacked(streamId)), delegate);
  }

  function revokePausable(uint256 streamId, address delegate)
    external
    override
  {
    revokeRole(keccak256(abi.encodePacked(streamId)), delegate);
  }

  function pauseStream(uint256 streamId)
    external
    override
    onlyPayerOrDelegated(streamId)
  {
    streams[streamId].paused = true;
    emit StreamPaused(streamId);
  }

  function unpauseStream(uint256 streamId)
    external
    override
    onlyPayerOrDelegated(streamId)
  {
    streams[streamId].paused = false;
    emit StreamUnpaused(streamId);
  }

  function updatePayee(uint256 streamId, address newPayee)
    external
    override
    onlyPayer(streamId)
  {
    require(newPayee != address(0), "newPayee invalid");
    streams[streamId].payee = newPayee;
    emit PayeeUpdated(streamId, newPayee);
  }

  function updateFundingAddress(uint256 streamId, address newFundingAddress)
    external
    override
    onlyPayer(streamId)
  {
    require(newFundingAddress != address(0), "newFundingAddress invalid");
    streams[streamId].fundingAddress = newFundingAddress;
    emit FundingAddressUpdated(streamId, newFundingAddress);
  }

  function updateFundingRate(
    uint256 streamId,
    uint256 usdAmount,
    uint256 endTime
  ) external override onlyPayer(streamId) {
    Stream memory stream = streams[streamId];

    require(endTime > block.timestamp, "End time is in the past");

    uint256 accumulated = _claimable(streamId);
    uint256 amount = _usdToTokenAmount(stream.token, accumulated);

    stream.usdAmount = usdAmount;
    stream.startTime = block.timestamp;
    stream.secs = endTime - block.timestamp;
    stream.usdPerSec = usdAmount / stream.secs;
    stream.claimed = 0;

    streams[streamId] = stream;

    IERC20(stream.token).safeTransferFrom(
      stream.fundingAddress,
      stream.payee,
      amount
    );

    emit Claimed(streamId, accumulated, amount);
    emit StreamUpdated(streamId, usdAmount, endTime);
  }

  function claimable(uint256 streamId)
    external
    view
    override
    returns (uint256)
  {
    return _claimable(streamId);
  }

  // returns the claimable amount in USD
  function _claimable(uint256 streamId) internal view returns (uint256) {
    Stream memory stream = streams[streamId];

    uint256 elapsed = block.timestamp - stream.startTime;

    if (elapsed > stream.secs) {
      return stream.usdAmount - stream.claimed; // no more drips to avoid floating point dust
    }

    return (stream.usdPerSec * elapsed) - stream.claimed;
  }

  // returns the claimable amount in target token
  function claimableToken(uint256 streamId)
    external
    view
    override
    returns (uint256)
  {
    Stream memory stream = streams[streamId];

    uint256 accumulated = _claimable(streamId);

    return _usdToTokenAmount(stream.token, accumulated);
  }

  function _usdToTokenAmount(address token, uint256 amount)
    internal
    view
    returns (uint256)
  {
    AggregatorV3Interface oracle = supportedTokens[token];

    (, int256 price, , , ) = oracle.latestRoundData();

    uint8 decimals = oracle.decimals();

    uint256 scaledPrice = uint256(price) * (10**(18 - decimals)); // scales oracle price to 18 decimals

    return (amount * 1e18) / scaledPrice;
  }

  function claim(uint256 streamId) external override onlyPayee(streamId) {
    Stream memory stream = streams[streamId];

    require(!stream.paused, "Stream is paused");

    uint256 accumulated = _claimable(streamId);
    uint256 amount = _usdToTokenAmount(stream.token, accumulated);

    stream.claimed += accumulated;

    streams[streamId] = stream;

    IERC20(stream.token).safeTransferFrom(
      stream.fundingAddress,
      stream.payee,
      amount
    );

    emit Claimed(streamId, accumulated, amount);
  }
}
