//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { SchnorrSECP256K1 } from "../lib/SchnorrSECP256K1.sol";

contract TestSchnorr {
    function verifySignature(
        uint256 signingPubKeyX,
        uint8 pubKeyYParity,
        uint256 signature,
        uint256 msgHash,
        address nonceTimesGeneratorAddress
    ) external pure returns (bool) {
        return
            SchnorrSECP256K1.verifySignature(
                signingPubKeyX,
                pubKeyYParity,
                signature,
                msgHash,
                nonceTimesGeneratorAddress
            );
    }
}
