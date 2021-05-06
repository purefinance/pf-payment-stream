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
    uint usdAmount;
    address token;
    address fundingAddress;
    address payer;
    bool paused;
    uint startTime;
    uint endTime;
    uint secs;
    uint claimed;

  }

  modifier onlyPayer(uint streamId) {
    require(msg.sender == streams[streamId].payer, "Not stream owner");
    _;
  }

  modifier onlyPayerOrDelegated(uint streamId) {

    require(msg.sender == streams[streamId].payer || 
            hasRole(keccak256(abi.encodePacked(streamId)),msg.sender
    ), "Not stream owner/delegated");
    _;
  }

  modifier onlyPayee(uint streamId) {
    require(msg.sender == streams[streamId].payee, "Not payee");
    _;
  }
  
  mapping (uint => Stream) streams;
  mapping (address => AggregatorV3Interface) supportedTokens; // token address => oracle address

  uint totalStreams = 0;

  event newStream(uint id, address payer, address payee, uint usdAmount);
  event tokenAdded(address tokenAddress, address oracleAddress);
  event claimed(uint id, uint usdAmount, uint tokenAmount);

  /*
        adds supported tokens by setting a mapping to token => oracle
  */

  function _addToken(address tokenAddress, address oracleAddress) internal {
      
      require(oracleAddress != address(0),"Oracle address missing");
    
      supportedTokens[tokenAddress] = AggregatorV3Interface(oracleAddress);

      emit tokenAdded(tokenAddress, oracleAddress);
  
  }

  function addToken(address tokenAddress, address oracleAddress) external onlyOwner {

        _addToken(tokenAddress, oracleAddress);
  
  }

  function getStream(uint streamId) public view returns (Stream memory) {

    return streams[streamId];

  }
  
  function getStreamsCount() public view returns (uint) {

    return totalStreams;
  
  }

  function createStream(address payee, uint usdAmount, address token, address fundingAddress, uint endTime) public returns (uint) {
      
      require(endTime > block.timestamp, "End time is in the past");
      require(payee != fundingAddress,"payee == fundingAddress");
      require(payee != address(0) && fundingAddress != address(0), "invalid payee or fundingAddress");
      require(usdAmount > 0, "usdAmount == 0");
      require(address(supportedTokens[token]) != address(0),"Token not supported");


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

      uint streamId = totalStreams;

      streams[streamId] = stream;
      
      _setupRole(keccak256(abi.encodePacked(streamId)), msg.sender);

      emit newStream(streamId, stream.payer, payee, usdAmount);

      totalStreams++;

      return streamId;

  }


  function delegatePausable(uint streamId, address delegate) onlyPayerOrDelegated(streamId) external {

      require(delegate != address(0), "Invalid delegate");
      
      _setupRole(keccak256(abi.encodePacked(streamId)), delegate);
  }

  function pauseStream(uint streamId) onlyPayerOrDelegated(streamId) external {
      streams[streamId].paused = true;
  }

  function unpauseStream(uint streamId) onlyPayerOrDelegated(streamId) external {
      streams[streamId].paused = false;
  }

  function setPayee(uint streamId,address newPayee) onlyPayer(streamId) external {

      require(newPayee != address(0),"newPayee invalid");
      streams[streamId].payee = newPayee;

  }

  function setFundingAddress(uint streamId, address newFundingAddress) onlyPayer(streamId) external {

      require(newFundingAddress != address(0),"newFundingAddress invalid");      
      streams[streamId].fundingAddress = newFundingAddress;

  }

  function setFundingRate(uint streamId, uint usdAmount, uint endTime) onlyPayer(streamId) external {

      require(usdAmount > 0, "usdAmount = 0");
      require(endTime > block.timestamp,"End time is in the past");

      Stream memory stream = streams[streamId];

      stream.usdAmount = usdAmount;
      stream.startTime = block.timestamp;
      stream.endTime = endTime;

      stream.secs = endTime - block.timestamp;
      stream.claimed = 0;

      streams[streamId] = stream;

  }

  // returns the claimable amount in USD
  function claimable (uint streamId) public view returns (uint) {

      Stream memory stream = streams[streamId];

      uint usdPerSec = (stream.usdAmount)/stream.secs;
      uint elapsed = block.timestamp - stream.startTime;

      if (elapsed > stream.secs) {

        return stream.usdAmount - stream.claimed; // no more drips to avoid floating point dust

      }

      return ((usdPerSec)*elapsed) - stream.claimed;

  }

  // returns the claimable amount in target token
  function claimableToken (uint streamId) public view returns (uint) {

    Stream memory stream = streams[streamId];

    uint accumulated = claimable(streamId);

    AggregatorV3Interface oracle = supportedTokens[stream.token];

    ( , int256 price, , ,) = oracle.latestRoundData();

    price = price*1e10; // usd price scaled to 18 decimals (from 8)
    
    return (accumulated * 1e18) / uint(price);

  }

  function claim(uint streamId) onlyPayee(streamId) public returns (bool) {

      Stream memory stream = streams[streamId];

      require(stream.paused == false,"Stream is paused");

      uint accumulated = claimable(streamId);

      AggregatorV3Interface oracle = supportedTokens[stream.token];

      ( , int256 price, , ,) = oracle.latestRoundData();

      price = price*1e10; // usd price scaled to 18 decimals (from 8)
      
      uint amount = (accumulated * 1e18) / uint(price);

      stream.claimed += accumulated;

      streams[streamId] = stream;

      IERC20 token = IERC20(stream.token);

      token.safeTransferFrom(stream.fundingAddress, stream.payee, amount);

      emit claimed(streamId, accumulated, amount);
      
      return true;

  }

}