// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.0;

/**
 * @title Message Library
 * @author Illusory Systems Inc.
 * @notice Library for formatted messages used by Home and Replica.
 **/
library MessageLib {
    function encodeMessage(
        uint256 origin,
        uint256 destination,
        address sender,
        address recipient,
        uint256 nonce,
        bytes memory message
    ) internal pure returns (bytes memory encodedMessage) {
        // TODO: Use abi.encodePacked instead since it is cheaper. If so,
        // decoding with abi.decode won't work. Thus, we'll have to take the same approach
        // as Nomad for using the TypedMemView.sol library for using pointers instead.
        // See https://github.com/nomad-xyz/nomad-monorepo/blob/main/solidity/nomad-core/libs/Message.sol
        return abi.encode(origin, destination, sender, recipient, nonce, message);
    }

    function decodeMessage(bytes memory encodedMessage)
        internal
        pure
        returns (
            uint256 origin,
            uint256 destination,
            address sender,
            address recipient,
            uint256 nonce,
            bytes memory message
        )
    {
        return abi.decode(encodedMessage, (uint256, uint256, address, address, uint256, bytes));
    }
}
