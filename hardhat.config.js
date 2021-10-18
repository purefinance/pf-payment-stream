require("solidity-coverage");
require('@nomiclabs/hardhat-ethers')
require('@nomiclabs/hardhat-waffle')
require("@nomiclabs/hardhat-etherscan");
require('hardhat-contract-sizer')
require('hardhat-deploy')
require("hardhat-gas-reporter");
require("dotenv").config()

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000
      }
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.NODE_URL,
      },
      accounts: {
        mnemonic: process.env.MNEMONIC
      },
      initialBaseFeePerGas: 0
    },
    mainnet: {
      url: process.env.NODE_URL,
      //accounts: [`0x${process.env.PRIVATE_KEY}`],
      chainId: 1
    }
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
  paths: {
    deployments: "deployments"
  },
  namedAccounts: {
    deployer: process.env.DEPLOYER || 0
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? true : false
  }
};

