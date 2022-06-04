//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { DKG } from "./DKG.sol";
import { IndexedNodeSet } from "./lib/IndexedNodeSet.sol";

contract Oracle is DKG {
    using IndexedNodeSet for IndexedNodeSet.Set;

    event RootSubmitted(address indexed aggregator, uint256 indexed rootBlockNumber);

    bytes32 public oracleRoot;
    uint256 public oracleRootBlockNumber;
    uint256 public oracleRandomness;
    uint256 public lastEpoch;

    uint256 public ORACLE_AGGREGATION_EPOCH_LENGTH;
    uint256 public ORACLE_BLOCK_NUMBER_ZERO;

    constructor(
        uint256 _STAKE,
        uint256 _KEY_GEN_INTERVAL,
        uint256 _SECURITY_PARAMETER,
        uint256 _DKG_AGGREGATION_EPOCH_LENGTH,
        uint256 _ORACLE_AGGREGATION_EPOCH_LENGTH
    ) DKG(_STAKE, _KEY_GEN_INTERVAL, _SECURITY_PARAMETER, _DKG_AGGREGATION_EPOCH_LENGTH) {
        ORACLE_AGGREGATION_EPOCH_LENGTH = _ORACLE_AGGREGATION_EPOCH_LENGTH;
        ORACLE_BLOCK_NUMBER_ZERO = block.number;
    }

    function updateRoot(
        uint256[2] calldata _signature,
        bytes32 _root,
        uint256 _rootBlockNumber
    ) external notGenerating onlyOracleNode {
        uint256 currentEpoch = getEpoch(block.number);
        uint256 callerIndex = nodes.getIndexById(msg.sender);
        require(currentEpoch > lastEpoch, "!epoch");
        require(callerIndex == getAggregatorIndex(currentEpoch), "!aggregator");
        require(_rootBlockNumber > oracleRootBlockNumber, "!rootBlockNumber");
        require(
            verifySignature(_signature, masterPublicKey, abi.encodePacked(_root, _rootBlockNumber)),
            "invalid signature"
        );
        oracleRoot = _root;
        oracleRootBlockNumber = _rootBlockNumber;
        oracleRandomness = _signature[0];
        lastEpoch = currentEpoch;
        emit RootSubmitted(msg.sender, _rootBlockNumber);
    }

    function getEpoch(uint256 _blocknumber) public view returns (uint256 epoch) {
        return (_blocknumber - ORACLE_BLOCK_NUMBER_ZERO) / ORACLE_AGGREGATION_EPOCH_LENGTH;
    }

    function getAggregatorIndex(uint256 _epoch) public view returns (uint256 index) {
        return (oracleRandomness + _epoch) % nodes.size();
    }
}
