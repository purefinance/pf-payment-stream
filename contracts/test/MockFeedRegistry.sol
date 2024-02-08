//SPDX-License-Identifier: MIT

/* Dummy FeedRegistry For testing purpose */

pragma solidity 0.8.9;

import {Denominations} from "@chainlink/contracts/src/v0.8/Denominations.sol";

contract MockFeedRegistry {
    struct PriceInfo {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    // mock price. base => quote => price
    mapping(address => mapping(address => PriceInfo)) private _priceInfo;
    uint256 private _roundId;
    uint256 private _startTimestamp;
    error FeedIsNotSupported();
    error IncorrectQuote();

    function latestRoundData(
        address base,
        address quote
    )
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (quote != Denominations.USD && quote != Denominations.ETH) revert IncorrectQuote();

        PriceInfo memory _info = _priceInfo[base][quote];
        answer = _info.answer;
        if (answer == 0) revert FeedIsNotSupported();

        roundId = uint80(_roundId);
        startedAt = _info.startedAt;
        updatedAt = _info.updatedAt;
        answeredInRound = roundId;
    }

    function getFeed(address, address) external pure returns (address) {
        return address(0);
    }

    function updatePrice(address base, address quote, int256 price) external {
        if (quote != Denominations.USD && quote != Denominations.ETH) revert IncorrectQuote();
        _priceInfo[base][quote].answer = price;
        _priceInfo[base][quote].updatedAt = block.timestamp;
        _roundId++;
    }
}
