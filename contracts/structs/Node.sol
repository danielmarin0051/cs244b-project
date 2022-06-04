//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

struct Node {
    string server;
    uint256 stake;
    uint256 aggregations;
    uint256[4] publicKey;
}
