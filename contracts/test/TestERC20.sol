//SPDX-License-Identifier: MIT

/* Dummy ERC20 For testing purpose */

pragma solidity 0.8.9;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor(uint256 totalSupply_) ERC20("Wrapped Ether", "WETH") {
        _mint(msg.sender, totalSupply_);
    }
}
