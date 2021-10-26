const name = 'PaymentStreamFactory'
const version = 'v1.0.2'

const FEED_REGISTRY_ADDRESS = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf'

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()
  await deploy(name, {
    from: deployer,
    log: true,
    args: [FEED_REGISTRY_ADDRESS]
  })

  return true
}

module.exports.id = `${name}-${version}`
