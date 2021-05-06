# Pure Finance Payment Stream
Payment stream contract for [pure.finance](https://pure.finance)
- [Design specs](https://docs.google.com/document/d/17xmWzQTd_gW2GGcn-mgoRBR6kHcjV--LJhkv-frAcls/edit#heading=h.cljfvymqw9x2)

Stack:
- [Hardhat](https://hardhat.org/)
- [Ethers.js](https://docs.ethers.io/v5/)

## How to use this repository

```
$ npm install
$ echo NODE_URL=YOUR_NODE_URL > .env # required for mainnet fork
```

### Build Contracts
```
$ npx hardhat compile
```

### Testing
```
$ npx hardhat test
```

### Coverage Report
```
$ npx hardhat coverage
```