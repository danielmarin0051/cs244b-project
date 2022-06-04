# CS 244b Final Project

This repo implements a decentralized distributed key generation primitive for blockchain applications. In particular, we use gRPC to implement a distributed verion of Pedersen's Distributed Key Generation protocol for elliptic curve cryptosystems.

Make sure to install [Tendermint](https://github.com/tendermint/tendermint).

This repo includes other code useful for instantiating a cross-chain blockchain application using our DKG primitive, but that is not well tested yet.

To run the DKG-BFT tests do `yarn install`, `yarn hardhat compile`. Then if using a local Ethereum EVM instance as broascast channel, in a separate terminal run `yarn run chainC`. Else, if using Tendermint as broadcast channel, instantiate manually a set of N Tendermint server instances. Then run `yarn run test:single src/DDKGNode.test.ts` with the appropriate `BroadcastChannel` class.
