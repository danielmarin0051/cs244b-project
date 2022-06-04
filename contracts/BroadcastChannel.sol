//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "hardhat/console.sol";

contract BroadcastChannel {
    event Broadcast(address indexed sender, uint256 indexed sessionId, uint256 indexed topic, bytes message);

    function broadcast(
        uint256 _sessionId,
        uint256 _topic,
        bytes calldata _message
    ) external {
        emit Broadcast(msg.sender, _sessionId, _topic, _message);
    }
}
