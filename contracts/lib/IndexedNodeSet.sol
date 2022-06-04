//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import { Node } from "../structs/Node.sol";

library IndexedNodeSet {
    //https://github.com/rob-Hitchens/UnorderedKeySet/blob/master/contracts/HitchensUnorderedKeySet.sol
    //https://ethereum.stackexchange.com/questions/13167/are-there-well-solved-and-simple-storage-patterns-for-solidity

    struct IndexedNode {
        uint256 index;
        Node node;
    }

    struct Set {
        mapping(address => IndexedNode) map;
        address[] list;
    }

    function size(Set storage self) internal view returns (uint256) {
        return self.list.length;
    }

    function exists(Set storage self, address id) internal view returns (bool) {
        if (self.list.length == 0) return false;
        return self.list[self.map[id].index] == id;
    }

    function add(
        Set storage self,
        address id,
        Node memory node
    ) internal {
        if (exists(self, id)) revert("exists");
        self.list.push(id);
        self.map[id] = IndexedNode(size(self) - 1, node);
    }

    function remove(Set storage self, address id) internal {
        if (!exists(self, id)) revert("!exists");
        uint256 indexToDelete = self.map[id].index;
        address idToMove = self.list[size(self) - 1];
        self.map[idToMove].index = indexToDelete;
        self.list[indexToDelete] = idToMove;
        delete self.map[id];
        self.list.pop();
    }

    function getByIndex(Set storage self, uint256 index) internal view returns (Node storage) {
        return self.map[self.list[index]].node;
    }

    function getById(Set storage self, address id) internal view returns (Node storage) {
        return self.map[id].node;
    }

    function getIdByIndex(Set storage self, uint256 index) internal view returns (address) {
        return self.list[index];
    }

    function getIndexById(Set storage self, address id) internal view returns (uint256) {
        return self.map[id].index;
    }

    function clear(Set storage self) internal {
        for (uint256 i = 0; i < size(self); i++) {
            delete self.map[self.list[i]];
        }
        delete self.list;
    }
}
