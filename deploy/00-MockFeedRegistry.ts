import { HardhatRuntimeEnvironment, HttpNetworkConfig } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const name = 'MockFeedRegistry'
const version = 'v1.0.0'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, run } = hre
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  if (hre.network.name === 'hemiSepolia') {
    const deployed = await deploy(name, { from: deployer, log: true, args: [] })

    const networkConfig = hre.network.config as unknown as HttpNetworkConfig
    if (!networkConfig.url.includes('localhost')) {
      console.log('Verifying source code on the block explorer')
      await run('verify:verify', { address: deployed.address, noCompile: true })
    }
  } else {
    console.log('Skipped MockFeedRegistry deployment')
  }

  func.id = `${name}-${version}`
  return true
}

export default func
