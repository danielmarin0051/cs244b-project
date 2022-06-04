//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { MessageLib } from "./lib/Message.sol";
import { MerkleTreeLib } from "./lib/MerkleTree.sol";

import "hardhat/console.sol";

contract Messenger {
    // =========== Libraries ===========

    using MerkleTreeLib for MerkleTreeLib.Tree;

    // =========== Storage =============

    MerkleTreeLib.Tree public tree;
    uint256 public nonce;

    // =========== Constants ===========

    uint256 public immutable ORIGIN_CHAIN_ID;

    // =========== Events ==============

    event MessageSent(bytes32 indexed packetHash);

    // ========== Constructor ==========

    constructor(uint256 _originChainId) {
        ORIGIN_CHAIN_ID = _originChainId;
    }

    // ========== External =============

    function sendMessage(
        uint256 _chainId,
        address _recipient,
        bytes memory _message
    ) external {
        bytes memory packet = MessageLib.encodeMessage({
            origin: ORIGIN_CHAIN_ID,
            destination: _chainId,
            sender: msg.sender,
            recipient: _recipient,
            nonce: nonce,
            message: _message
        });

        bytes32 packetHash = keccak256(packet);
        tree.insert(packetHash);

        nonce += 1;

        emit MessageSent(packetHash);
}

    // ========== External: View =============

    function root() external view returns (bytes32) {
        return tree.root();
    }

    function messageCount() external view returns (uint256) {
        return tree.count;
    }
}
