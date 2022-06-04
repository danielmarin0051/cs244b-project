//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { BLS } from "../lib/BLS.sol";

contract TestBLS {
    function verify(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        bytes memory message
    ) external view returns (bool) {
        return BLS.verify(signature, pubkey, message);
    }

    function verifySingle(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        uint256[2] memory message
    ) external view returns (bool) {
        return BLS.verifySingle(signature, pubkey, message);
    }

    function hashToPoint(bytes memory data) external view returns (uint256[2] memory) {
        return BLS.hashToPoint(data);
    }
}
