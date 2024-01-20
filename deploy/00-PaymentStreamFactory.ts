import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const name = 'PaymentStreamFactory'
const version = 'v1.0.2'

const FEED_REGISTRY_ADDRESS = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy(name, {
    from: deployer,
    log: true,
    args: [FEED_REGISTRY_ADDRESS],
  })

  func.id = `${name}-${version}`
  return true
}

export default func
