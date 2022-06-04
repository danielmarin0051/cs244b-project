//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import { BLS } from "./lib/BLS.sol";
import { IndexedAddressSet } from "./lib/IndexedAddressSet.sol";
import { IndexedNodeSet } from "./lib/IndexedNodeSet.sol";
import { Node } from "./structs/Node.sol";

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract DKG is Ownable {
    using IndexedNodeSet for IndexedNodeSet.Set;
    using IndexedAddressSet for IndexedAddressSet.Set;

    event DKGInitiated(uint256 indexed sessionId);
    event DKGCompleted(uint256 indexed sessionId);

    IndexedNodeSet.Set internal nodes;
    IndexedNodeSet.Set internal waitlist;
    IndexedAddressSet.Set internal deregistrationWaitlist;

    bool public isGenerating;
    uint256 public nodeThreshold;
    uint256 public DKGRandomness;
    uint256[4] public masterPublicKey;
    uint256 public lastSessionId;

    mapping(address => mapping(address => bool)) public reports;
    mapping(address => uint256) public reportCounts;
    mapping(address => uint256) public withdrawableBalances;

    uint256 public STAKE;
    uint256 public KEY_GEN_INTERVAL;
    uint256 public SECURITY_PARAMETER;
    uint256 public DKG_AGGREGATION_EPOCH_LENGTH;

    constructor(
        uint256 _stake,
        uint256 _keyGenInterval,
        uint256 _securityParameter,
        uint256 _DKG_AGGREGATION_EPOCH_LENGTH
    ) {
        STAKE = _stake;
        KEY_GEN_INTERVAL = _keyGenInterval;
        SECURITY_PARAMETER = _securityParameter;
        DKG_AGGREGATION_EPOCH_LENGTH = _DKG_AGGREGATION_EPOCH_LENGTH;
    }

    function initDKG() internal {
        isGenerating = true;
        lastSessionId = block.number;
        emit DKGInitiated(lastSessionId);
    }

    function completeDKG(
        uint256[2] calldata _signature,
        uint256[4] calldata _masterPublicKey,
        address[] calldata _disqualified,
        uint256 _sessionId
    ) external {
        require(isGenerating, "not generating");
        require(_sessionId == lastSessionId, "!sessionId");
        require(getDKGAggregator() == msg.sender, "!aggregator");
        require(
            verifySignature(_signature, masterPublicKey, abi.encodePacked(_masterPublicKey, _disqualified, _sessionId)),
            "invalid signature"
        );

        // add from waitlist
        for (uint256 i = 0; i < waitlist.size(); i++) {
            address nodeId = waitlist.getIdByIndex(i);
            nodes.add(nodeId, waitlist.getById(nodeId));
        }
        waitlist.clear();

        for (uint256 i = 0; i < _disqualified.length; i++) {
            _slashAndRemove(_disqualified[i]);
        }

        isGenerating = false;
        masterPublicKey = _masterPublicKey;
        DKGRandomness = _signature[0];
        nodeThreshold = getThreshold(nodes.size());
        lastSessionId = _sessionId;
        nodes.getById(msg.sender).aggregations += 1;

        emit DKGCompleted(_sessionId);
    }

    function register(string calldata _server, uint256[4] calldata publicKey) external payable notGenerating {
        require(!nodes.exists(msg.sender), "already registered");
        require(!waitlist.exists(msg.sender), "already in waitlist");
        require(msg.value == STAKE, "msg.value != STAKE");
        waitlist.add(msg.sender, Node({ server: _server, stake: STAKE, publicKey: publicKey, aggregations: 0 }));
        if (waitlist.size() == KEY_GEN_INTERVAL) {
            initDKG();
        }
    }

    function deregister() external notGenerating onlyOracleNode {
        require(!deregistrationWaitlist.exists(msg.sender), "already in waitlist");
        _deregisterNode(msg.sender);
    }

    function withdraw() external {
        uint256 balance = withdrawableBalances[msg.sender];
        withdrawableBalances[msg.sender] = 0;
        payable(msg.sender).transfer(balance);
    }

    function report(address nodeId) external onlyOracleNode notGenerating {
        require(nodes.exists(nodeId), "accused doesn't exist");
        require(!reports[msg.sender][nodeId], "already reported");
        reports[msg.sender][nodeId] = true;
        reportCounts[nodeId] += 1;
        if (reportCounts[nodeId] > nodeThreshold) {
            _slashAndExecuteDKGIfNeeded(nodeId);
        }
    }

    function getDKGAggregator() public view returns (address) {
        return nodes.getIdByIndex(getDKGAgregatorIndexByBlock(block.number));
    }

    function getDKGAgregatorIndexByBlock(uint256 _blocknumber) public view returns (uint256) {
        return ((DKGRandomness + _blocknumber) / DKG_AGGREGATION_EPOCH_LENGTH) % nodes.size();
    }

    function getThreshold(uint256 _nodeSize) public view returns (uint256) {
        return (SECURITY_PARAMETER * (_nodeSize - 1)) / 100;
    }

    function _slashAndExecuteDKGIfNeeded(address nodeId) internal {
        _slashAndRemove(nodeId);
        if (!deregistrationWaitlist.exists(nodeId)) {
            _deregisterNode(nodeId);
        }
    }

    function _slashAndRemove(address nodeId) internal {
        nodes.remove(nodeId);
    }

    function _deregisterNode(address _nodeId) internal {
        deregistrationWaitlist.add(_nodeId);
        if (deregistrationWaitlist.size() == KEY_GEN_INTERVAL) {
            for (uint256 i = 0; i < deregistrationWaitlist.size(); i++) {
                address nodeId = deregistrationWaitlist.getByIndex(i);
                if (nodes.exists(nodeId)) {
                    withdrawableBalances[nodeId] = nodes.getById(nodeId).stake;
                    nodes.remove(nodeId);
                }
            }
            deregistrationWaitlist.clear();
            initDKG();
        }
    }

    function _registerNodeZero(string calldata _server, uint256[4] calldata publicKey) external payable onlyOwner {
        require(nodes.size() == 0, "!nodes.size == 0");
        require(msg.value == STAKE, "msg.value != STAKE");
        nodes.add(msg.sender, Node({ server: _server, stake: STAKE, publicKey: publicKey, aggregations: 0 }));
        masterPublicKey = publicKey;
    }

    modifier notGenerating() {
        require(!isGenerating, "isGenerating");
        _;
    }

    modifier onlyOracleNode() {
        require(nodes.exists(msg.sender), "!oracle node");
        _;
    }

    function verifySignature(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        bytes memory message
    ) public view returns (bool) {
        return BLS.verify(signature, pubkey, message);
    }

    // view
    function size() public view returns (uint256) {
        return nodes.size();
    }

    function waitlistSize() public view returns (uint256) {
        return waitlist.size();
    }

    function deregistrationWaitlistSize() public view returns (uint256) {
        return deregistrationWaitlist.size();
    }

    function getFullNodeByIndex(uint256 index) public view returns (Node memory node, address account) {
        return (getNodeByIndex(index), getNodeAddressByIndex(index));
    }

    function getFullWaitlistNodeByIndex(uint256 index) public view returns (Node memory node, address account) {
        return (getWaitlistNodeByIndex(index), getWaitlistNodeAddressByIndex(index));
    }

    function getNodeByIndex(uint256 index) public view returns (Node memory) {
        return nodes.getByIndex(index);
    }

    function getNodeByAddress(address nodeId) public view returns (Node memory) {
        return nodes.getById(nodeId);
    }

    function getNodeAddressByIndex(uint256 index) public view returns (address) {
        return nodes.getIdByIndex(index);
    }

    function getNodeIndexByAddress(address nodeId) public view returns (uint256) {
        return nodes.getIndexById(nodeId);
    }

    function getWaitlistNodeByIndex(uint256 index) public view returns (Node memory) {
        return waitlist.getByIndex(index);
    }

    function getWaitlistNodeAddressByIndex(uint256 index) public view returns (address) {
        return waitlist.getIdByIndex(index);
    }

    // testing

    function _TEST_initDKG() external onlyOwner {
        initDKG();
    }

    function _TEST_register(
        address account,
        string calldata _server,
        uint256[4] calldata publicKey
    ) external payable onlyOwner {
        require(!nodes.exists(account), "already registered");
        require(msg.value == STAKE, "msg.value != STAKE");
        nodes.add(account, Node({ server: _server, stake: STAKE, publicKey: publicKey, aggregations: 0 }));
    }

    function _TEST_SetMasterPK(uint256[4] calldata _masterPublicKey) external onlyOwner {
        masterPublicKey = _masterPublicKey;
    }
}
