//SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

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
  uint256 usdPerSec;
  uint256 claimed;
}

interface IPaymentStream {
  event NewStream(
    uint256 id,
    address indexed payer,
    address payee,
    uint256 usdAmount
  );
  event TokenAdded(address indexed tokenAddress, address oracleAddress);
  event Claimed(uint256 indexed id, uint256 usdAmount, uint256 tokenAmount);
  event StreamPaused(uint256 indexed id);
  event StreamUnpaused(uint256 indexed id);

  function createStream(
    address payee,
    uint256 usdAmount,
    address token,
    address fundingAddress,
    uint256 endTime
  ) external returns (uint256);

  function getStreamsCount() external view returns (uint256);

  function addToken(address tokenAddress, address oracleAddress) external;

  function claim(uint256 streamId) external;

  function claimableToken(uint256 streamId) external view returns (uint256);

  function claimable(uint256 streamId) external view returns (uint256);

  function pauseStream(uint256 streamId) external;

  function unpauseStream(uint256 streamId) external;

  function delegatePausable(uint256 streamId, address delegate) external;

  function revokePausable(uint256 streamId, address delegate) external;
}
