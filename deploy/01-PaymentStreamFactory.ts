import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const name = 'PaymentStreamFactory'
const version = 'v1.0.2'

// Ethereum mainnet address of chainlink feed registry
let feedRegistryAddress = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, run } = hre
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  if (hre.network.name === 'hemi') {
    feedRegistryAddress = (await deployments.get('MockFeedRegistry')).address
  }

  const deployed = await deploy(name, { from: deployer, log: true, args: [feedRegistryAddress] })

  if (hre.network.name !== 'localhost') {
    console.log('Verifying source code on the block explorer')
    await run('verify:verify', {
      address: deployed.address,
      noCompile: true,
      constructorArguments: [feedRegistryAddress],
    })
  }

  func.id = `${name}-${version}`
  return true
}

export default func
