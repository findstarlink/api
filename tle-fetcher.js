module.exports = new TLEFetcher()

function TLEFetcher() {
    var d = new Date()
    var ts = d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate()
    const TLE_URL = "https://findstarlink.com/data/tle.json?v=" + ts
    const TLE_EXPIRES_AFTER = 60 * 60 * 1000 // ms

    var tleObj = {}
    var tleExpiresAt = 0 // ms, local epoch time

    this.fetchTLE = async function (forceFresh) {
        forceFresh = (forceFresh === undefined ? false : forceFresh)

        var currTime = new Date().getTime()
        if (currTime <= tleExpiresAt && forceFresh === false) {
            return tleObj
        }

        var url = TLE_URL + (forceFresh === true ? '.' + currTime : '')

        let response = await fetch(url)
        response = await response.json()
        tleObj = response
        tleExpiresAt = currTime + TLE_EXPIRES_AFTER

        return tleObj
    }
}
