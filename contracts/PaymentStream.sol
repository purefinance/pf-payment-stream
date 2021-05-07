//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.3;
pragma experimental ABIEncoderV2;

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract PaymentStream is Ownable, AccessControl {
  using SafeERC20 for IERC20;

  struct Stream {
    address payee;
    uint256 usdAmount;
    address token;
    address fundingAddress;
    address payer;
    bool paused;
    uint256 startTime;
    uint256 endTime;
    uint256 secs;
    uint256 claimed;
  }

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

  uint256 public totalStreams = 0;

  event newStream(uint256 id, address payer, address payee, uint256 usdAmount);
  event tokenAdded(address tokenAddress, address oracleAddress);
  event claimed(uint256 id, uint256 usdAmount, uint256 tokenAmount);

  /*
        adds supported tokens by setting a mapping to token => oracle
  */

  function _addToken(address tokenAddress, address oracleAddress) internal {
    require(oracleAddress != address(0), "Oracle address missing");

    supportedTokens[tokenAddress] = AggregatorV3Interface(oracleAddress);

    emit tokenAdded(tokenAddress, oracleAddress);
  }

  function addToken(address tokenAddress, address oracleAddress)
    external
    onlyOwner
  {
    _addToken(tokenAddress, oracleAddress);
  }

  function getStream(uint256 streamId) public view returns (Stream memory) {
    return streams[streamId];
  }

  function getStreamsCount() public view returns (uint256) {
    return totalStreams;
  }

  function createStream(
    address payee,
    uint256 usdAmount,
    address token,
    address fundingAddress,
    uint256 endTime
  ) public returns (uint256) {
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
    stream.endTime = endTime;
    stream.secs = endTime - block.timestamp;

    stream.claimed = 0;

    uint256 streamId = totalStreams;

    streams[streamId] = stream;

    //_setupRole(keccak256(abi.encodePacked(streamId)), msg.sender);

    emit newStream(streamId, stream.payer, payee, usdAmount);

    totalStreams++;

    return streamId;
  }

  function delegatePausable(uint256 streamId, address delegate)
    external
    onlyPayerOrDelegated(streamId)
  {
    require(delegate != address(0), "Invalid delegate");

    _setupRole(keccak256(abi.encodePacked(streamId)), delegate);
  }

  function pauseStream(uint256 streamId)
    external
    onlyPayerOrDelegated(streamId)
  {
    streams[streamId].paused = true;
  }

  function unpauseStream(uint256 streamId)
    external
    onlyPayerOrDelegated(streamId)
  {
    streams[streamId].paused = false;
  }

  function setPayee(uint256 streamId, address newPayee)
    external
    onlyPayer(streamId)
  {
    require(newPayee != address(0), "newPayee invalid");
    streams[streamId].payee = newPayee;
  }

  function setFundingAddress(uint256 streamId, address newFundingAddress)
    external
    onlyPayer(streamId)
  {
    require(newFundingAddress != address(0), "newFundingAddress invalid");
    streams[streamId].fundingAddress = newFundingAddress;
  }

  function setFundingRate(
    uint256 streamId,
    uint256 usdAmount,
    uint256 endTime
  ) external onlyPayer(streamId) {
    require(usdAmount > 0, "usdAmount = 0");
    require(endTime > block.timestamp, "End time is in the past");

    Stream memory stream = streams[streamId];

    stream.usdAmount = usdAmount;
    stream.startTime = block.timestamp;
    stream.endTime = endTime;

    stream.secs = endTime - block.timestamp;
    stream.claimed = 0;

    streams[streamId] = stream;
  }

  // returns the claimable amount in USD
  function claimable(uint256 streamId) public view returns (uint256) {
    Stream memory stream = streams[streamId];

    uint256 usdPerSec = (stream.usdAmount) / stream.secs;
    uint256 elapsed = block.timestamp - stream.startTime;

    if (elapsed > stream.secs) {
      return stream.usdAmount - stream.claimed; // no more drips to avoid floating point dust
    }

    return ((usdPerSec) * elapsed) - stream.claimed;
  }

  // returns the claimable amount in target token
  function claimableToken(uint256 streamId) public view returns (uint256) {
    Stream memory stream = streams[streamId];

    uint256 accumulated = claimable(streamId);

    AggregatorV3Interface oracle = supportedTokens[stream.token];

    (, int256 price, , , ) = oracle.latestRoundData();

    price = price * 1e10; // usd price scaled to 18 decimals (from 8)

    return (accumulated * 1e18) / uint256(price);
  }

  function claim(uint256 streamId) public onlyPayee(streamId) returns (bool) {
    Stream memory stream = streams[streamId];

    require(stream.paused == false, "Stream is paused");

    uint256 accumulated = claimable(streamId);

    AggregatorV3Interface oracle = supportedTokens[stream.token];

    (, int256 price, , , ) = oracle.latestRoundData();

    price = price * 1e10; // usd price scaled to 18 decimals (from 8)

    uint256 amount = (accumulated * 1e18) / uint256(price);

    stream.claimed += accumulated;

    streams[streamId] = stream;

    IERC20 token = IERC20(stream.token);

    token.safeTransferFrom(stream.fundingAddress, stream.payee, amount);

    emit claimed(streamId, accumulated, amount);

    return true;
  }
}
