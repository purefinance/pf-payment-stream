# Pure Finance Payment Stream

Payment stream contract for [pure.finance](https://pure.finance)

- [Design specs](https://docs.google.com/document/d/17xmWzQTd_gW2GGcn-mgoRBR6kHcjV--LJhkv-frAcls/edit#heading=h.cljfvymqw9x2)

Stack:

- [Hardhat](https://hardhat.org/)
- [Ethers.js](https://docs.ethers.io/v5/)

## How to use this repository

```sh
npm install
echo NODE_URL=YOUR_NODE_URL > .env # required for mainnet fork
```

### Build Contracts

```sh
npx hardhat compile
```

### Testing

```sh
npx hardhat test
```

### Coverage Report

```sh
npx hardhat coverage
```

### Development

To spin up a local fork and deploy the contracts, create a `.env` file with the following variables:

- `MNEMONIC`: The 12-word mnemonic phrase to derive the dev/test accounts.
- `NODE_URL`: URL of the JSON-RPC node to fork from.

Then run:

```sh
npx hardhat node
```

The forked JSON-RPC server will start, listen in http://127.0.0.1:8545 and have the contracts deployed.
