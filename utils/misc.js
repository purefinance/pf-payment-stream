const axios = require("axios");
const ethers = require("ethers");

async function ethToUsd(amount) {

    /*

        Performs an off-chain lookup of ether amount in usd scaled to 18 decimals
        
    */

    const ETHERSCAN_API = "https://api.etherscan.io/api?module=stats&action=ethprice";
    const DECIMALS = ethers.BigNumber.from("1000000000000000000");

    let { data } = await axios.get(ETHERSCAN_API);
    let { ethusd } = data.result;

    ethUsdBN = ethers.BigNumber.from(parseInt(ethusd));
    
    let usdAmount = amount.mul(ethUsdBN);

    return usdAmount;

}


module.exports = { ethToUsd };