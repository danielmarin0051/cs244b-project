//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { Oracle } from "./Oracle.sol";
import { Messenger } from "./Messenger.sol";
import { MessageLib } from "./lib/Message.sol";
import { MerkleTreeLib } from "./lib/MerkleTree.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

uint256 constant TREE_DEPTH = 32;

contract Nexus is Messenger, Ownable {
    using MerkleTreeLib for MerkleTreeLib.Tree;

    event MessageReceived(address sender, address recipient, uint256 nonce, bytes message);

    mapping(uint256 => address) public oracles;

    constructor(uint256 _ORIGIN_CHAIN_ID) Messenger(_ORIGIN_CHAIN_ID) {}

    function receiveMessage(bytes calldata packet, bytes calldata proof) external {
        (
            uint256 origin,
            uint256 destination,
            address sender,
            address recipient,
            uint256 nonce,
            bytes memory message
        ) = MessageLib.decodeMessage(packet);
        // TODO
        // require(destination == ORIGIN_CHAIN_ID, "!desination");
        // require(oracles[origin] != address(0), "!origin");

        (bytes32[TREE_DEPTH] memory branch, uint256 leafIndex) = abi.decode(proof, (bytes32[32], uint256));
        // TODO
        // require(
        //     MerkleTreeLib.branchRoot({ _item: keccak256(packet), _branch: branch, _index: leafIndex }) ==
        //         Oracle(oracles[origin]).oracleRoot(),
        //     "invalid proof"
        // );

        emit MessageReceived(sender, recipient, nonce, message);
    }

    // TODO
    // function setOracle(uint256 chainId, address oracleAddress) external onlyOwner {
    //     oracles[chainId] = oracleAddress;
    // }
}
