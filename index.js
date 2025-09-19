const predict = require('sat-timings')
const tleFetcher = require('./tle-fetcher')

/* globals */
const API_FINDSTARLINK = 'findstarlink'
const API_FINDSTARLINK_PATH = 'findstarlinkpath'

const PARAM_PRETTY_PRINT = 'pretty'

const PARAM_INCLUDE_SAT_IDS = 'includeSatIds'
const PARAM_LATITUDE = 'latitude'
const PARAM_LONGITUDE = 'longitude'
const PARAM_NUM_DAYS = 'numDays'
const PARAM_TIME_OF_DAY = 'timeOfDay'

const DEFAULT_DAYS_COUNT = 5
const DEFAULT_TIME_OF_DAY = 'all'
const DEFAULT_START_DAYS_OFFSET = -1
const MIN_DAYS_COUNT = 1
const MAX_DAYS_COUNT = 10

const DEFAULT_SAT_PATH_DURATION = 90 // mins

const SAT_TIMINGS_CLIENT_CACHE_DURATION = 5 // mins

const SAT_PATH_SERVER_CACHE_DURATION = 10 // mins
const SAT_PATH_CLIENT_CACHE_DURATION = 5 // mins

/* local */
const satPathCache = {
	expiresAt: 0, // ms
	result: {}
}

exports.handler = async (event) => {
	if (event.headers !== undefined && event.headers !== null) {
		console.log(event.headers['User-Agent'], event.headers['X-Forwarded-For'])
	}

	let api = API_FINDSTARLINK
	let apiVersion = "1"
	if (event.path !== undefined && event.path !== null) {
		if (event.path.indexOf("/v1.1/") === 0) {
			apiVersion = "1.1"
		}

		if (event.path.indexOf('/findstarlinkpath') !== -1) {
			api = API_FINDSTARLINK_PATH
		}
	}

	console.log('starting')
	var TLE = await tleFetcher.fetch()
	console.log('downloaded tle')

	let params = {}
	try {
		if (api === API_FINDSTARLINK) {
			params = parseFindStarlinkParams(TLE, event.queryStringParameters)
		} else if (api === API_FINDSTARLINK_PATH) {
			params = parseFindStarlinkPathParams(TLE, event.queryStringParameters)
		}
	} catch (e) {
		return { statusCode: 400, body: 'invalid parameters' }
	}

	params["apiVersion"] = apiVersion

	let response = {}
	if (api === API_FINDSTARLINK) {
		response = getVisibleTimings(TLE, params)
	} else if (api === API_FINDSTARLINK_PATH) {
		response = getSatellitePath(TLE, params)
	}

	return response
}

function getVisibleTimings(TLE, params) {
	console.log('checking ' + params.latitude + ',' + params.longitude)

	let res = getTimings(TLE, params)

	return buildResponse(res, params.prettyPrint, SAT_TIMINGS_CLIENT_CACHE_DURATION * 60)
}

function getSatellitePath(TLE, params) {
	console.log('fetching path')

	let res = satPathCache.result
	let now = new Date().getTime()

	if (now > satPathCache.expiresAt) {
		res = getPath(TLE, params)
		satPathCache.result = res
		satPathCache.expiresAt = now + SAT_PATH_SERVER_CACHE_DURATION * 60 * 1000
	}

	return buildResponse(res, params.prettyPrint, SAT_PATH_CLIENT_CACHE_DURATION * 60)
}

function buildResponse(results, prettyPrint, maxAge) {
	if (results === undefined) {
		return {
			statusCode: 404,
			body: 'satellite not found'
		}
	}

	let body = (prettyPrint === true ? JSON.stringify(results, null, 2) : JSON.stringify(results))
	let headers = { 'Content-Type': 'text/javascript' }

	if (maxAge !== undefined && maxAge !== null) {
		headers['Cache-Control'] = 'max-age=' + maxAge
	}

	return {
		statusCode: 200,
		body: body,
		headers: headers,
	}
}

function getTimings(TLE, params) {
	var results = undefined

	console.log('api version', params.apiVersion)

	var opts = {
		apiVersion: params.apiVersion,
		daysCount: params.daysCount,
		timeOfDay: params.timeOfDay,
		startDaysOffset: DEFAULT_START_DAYS_OFFSET
	}

	params.satIds.forEach(function (satId) {
		var sat = findTLE(TLE, satId)
		if (sat === undefined) {
			console.log('No TLE found for', satId)
			return
		}

		try {
			var res = predict.getVisibleTimes(sat, params.latitude, params.longitude, opts)
		} catch (e) {
			console.log('error predicting ' + satId, e)
			throw e
		}

		if (results === undefined) {
			results = res
		} else {
			results.timings.push.apply(results.timings, res.timings)
		}
	})

	function timeSorter(a, b) {
		return a.start.epoch - b.start.epoch // compares unix time of each
	}

	if (results === undefined) {
		return
	}

	results.timings = results.timings.sort(timeSorter)

	return results
}

function getPath(TLE, params) {
	let results = undefined

	let activeSats = TLE.satellites.filter(sat => sat.active)
	let focusSatId = activeSats[0].name

	params.satIds.forEach(function (satId) {
		var sat = findTLE(TLE, satId)
		if (sat === undefined) {
			console.log('No TLE found for', satId)
			return
		}

		var res = predict.getSatellitePath(sat, DEFAULT_SAT_PATH_DURATION)

		if (results === undefined) {
			results = {}
		}

		res.title = sat.title

		if (satId === focusSatId) {
			res.focus = true
		}

		results[satId] = res
	})

	return results
}

function parseFindStarlinkParams(TLE, params) {
	let activeSats = TLE.satellites.filter(sat => sat.active)
	let satIds = activeSats.map(sat => sat.name)

	if (params === undefined || params === null) {
		throw "no parameters passed!"
	}

	let prettyPrint = false
	if (params[PARAM_PRETTY_PRINT] !== undefined) {
		prettyPrint = true
	}

	if (params[PARAM_INCLUDE_SAT_IDS] !== undefined) {
		satIds = params[PARAM_INCLUDE_SAT_IDS].split(',')
	}

	var latitude = params[PARAM_LATITUDE]
	var longitude = params[PARAM_LONGITUDE]

	latitude = parseFloat(latitude)
	longitude = parseFloat(longitude)

	if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
		throw "invalid latitude or longitude"
	}

	if (latitude > 90 || latitude < -90 || longitude > 180 || longitude < -180) {
		throw "invalid latitude or longitude range"
	}

	var daysCount = params[PARAM_NUM_DAYS]
	if (daysCount === undefined) {
		daysCount = DEFAULT_DAYS_COUNT
	} else {
		daysCount = parseInt(daysCount)
		daysCount = (daysCount < MIN_DAYS_COUNT ? MIN_DAYS_COUNT : daysCount)
		daysCount = (daysCount > MAX_DAYS_COUNT ? MAX_DAYS_COUNT : daysCount)
	}

	var timeOfDay = params[PARAM_TIME_OF_DAY]
	if (timeOfDay === undefined) {
		timeOfDay = DEFAULT_TIME_OF_DAY
	}

	return {
		prettyPrint: prettyPrint,
		satIds: satIds,
		latitude: latitude, longitude: longitude,
		daysCount: daysCount,
		timeOfDay: timeOfDay
	}
}

function parseFindStarlinkPathParams(TLE, params) {
	let activeSats = TLE.satellites.filter(sat => sat.active)
	let satIds = activeSats.map(sat => sat.name)

	if (params === undefined || params === null) {
		params = {}
	}

	let prettyPrint = false
	if (params[PARAM_PRETTY_PRINT] !== undefined) {
		prettyPrint = true
	}

	if (params[PARAM_INCLUDE_SAT_IDS] !== undefined) {
		satIds = params[PARAM_INCLUDE_SAT_IDS].split(',')
	}

	return {
		prettyPrint: prettyPrint,
		satIds: satIds
	}
}

function findTLE(TLE, satId) {
	for (var idx in TLE.satellites) {
		if (TLE.satellites[idx].name === satId) {
			return TLE.satellites[idx]
		}
	}

	return undefined
}
