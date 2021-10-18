//SPDX-License-Identifier: MIT

/* Dummy ERC20 For testing purpose */

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FakeERC20 is ERC20 {
  constructor(uint256 initialSupply) ERC20("WETH", "Wrapped Ether") {
    _mint(msg.sender, initialSupply);
  }
}
