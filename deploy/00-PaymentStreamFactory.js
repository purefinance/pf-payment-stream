const name = 'PaymentStreamFactory'
const version = 'v1.0.0'

const SWAP_MANAGER_ADDRESS = '0xe382d9f2394A359B01006faa8A1864b8a60d2710'

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()
  await deploy(name, {
    from: deployer,
    log: true,
    args: [SWAP_MANAGER_ADDRESS]
  })

  return true
}

module.exports.id = `${name}-${version}`
