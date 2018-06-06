let request = require('request');

//
//  This function is responsible for getting the logs to CloudFlare and then
//  pass them to Sumo Logic.
//
exports.handler = async (event) => {

	//
	//	1.	Create a container that will be passed around the chain.
	//
	let container = {
		//
		//	Any request from a API or Lambda invocation goes here.
		//
		req: {},
		//
		//	Save all the env variable.
		//
		sumo_url               	 : process.env.SUMO_ENDPOINT,
		zone_id                  : process.env.CLOUDFLARE_ZONE_ID,
		cloudflare_auth_email    : process.env.CLOUDFLARE_AUTH_EMAIL,
		cloudflare_auth_key      : process.env.CLOUDFLARE_AUTH_KEY,
		source_category_override : process.env.SOURCE_CATEGORY_OVERRIDE || 	'none',
		source_host_override     : process.env.SOURCE_HOST_OVERRIDE 	|| 	'api.cloudflare.com',
		source_name_override     : process.env.SOURCE_NAME_OVERRIDE 	||	process.env.CLOUDFLARE_ZONE_ID,
		//
		//	This variable will hold all the logs from CloudFlare.
		//
		logs: "",
		//
		//	Used to hold arrays of logs per zone for SumoLogic.
		//
		sumo_logs: {},
		//
		//	The default response for Lambda.
		//
		res: "Done!"
	};

	//
	//	->	Start the chain.
	//
	try {

		container = await time_calculation(container);
		container = await request_logs(container);
		container = await prepare_data_for_sumo_logic(container);
		container = await pass_logs_to_sumo_logic(container);

	}
	catch(error)
	{
		//
		//	<>> Put the detail in the logs for easy debugging
		//
		console.log(error);
		
		//
		//  1.  Create a message to send back.
		//
		let message = {
			message: error.message || error
		};

		//
		//  2.  Create the response.
		//
		let response = {
			statusCode: error.status || 500,
			body: JSON.stringify(message, null, 4)
		};

		//
		//  ->  Tell lambda that we finished.
		//
		return response;
	}

	//
	//	->	Return a positive response
	//
	return container.response;
	
};

//	 _____    _____     ____    __  __   _____    _____   ______    _____
//	|  __ \  |  __ \   / __ \  |  \/  | |_   _|  / ____| |  ____|  / ____|
//	| |__) | | |__) | | |  | | | \  / |   | |   | (___   | |__    | (___
//	|  ___/  |  _  /  | |  | | | |\/| |   | |    \___ \  |  __|    \___ \
//	| |      | | \ \  | |__| | | |  | |  _| |_   ____) | | |____   ____) |
//	|_|      |_|  \_\  \____/  |_|  |_| |_____| |_____/  |______| |_____/
//

//
//	Prepare the time frame that we want to grab from CloudFlare.
//
function time_calculation(container)
{
	return new Promise(function(resolve, reject) {

		//
		//  1.	Logs are delayed by 30 minutes...
		//
		let end_time = new Date(new Date() - (30 * 60 * 1000));

		//
		//  2.	Set exact time.
		//
		end_time.setSeconds(0);
		end_time.setMilliseconds(0);

		//
		//	3.
		//
		let start_time = new Date(end_time - (1 * 60 * 1000));

		//
		//	<>> Log the times that we generated for easy debugging.
		//
		console.log("Start time: ", start_time);
		console.log("End time: ",   end_time);

		//
		//	4. Save the time for the next promise.
		//
		container.start_time = start_time;
		container.end_time = end_time;

		//
		//	->	Move to the next chain.
		//
		return resolve(container);

	});
}

//
//  Now that we have our starting and ending point we can ask
//  CloudFlare for the logs.
//
function request_logs(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Prepare the URL for the request.
		//
		let url = 'https://api.cloudflare.com/client/v4/zones/'
				  + container.zone_id
				  + '/logs/received';

		//
		// 	2.  Prepare all the options for the request.
		//
		let options = {
			url: url,
			json: true,
			headers: {
				'X-Auth-Email': container.cloudflare_auth_email,
				'X-Auth-Key': container.cloudflare_auth_key
			},
			qs: {
				start: "2018-06-06T18:43:00.000Z", //container.start_time,
				end: "2018-06-06T19:43:00.000Z", //container.end_time,
				fields: 'RayID,ClientIP'
			}
		};

		//
		//  -> Execute the request.
		//
		request.post(options, function(error, res, body) {
			
			//
			//  1.  Check if there was an internal error.
			//
			if(error)
			{
				return reject(error);
			}

			//
			//	Check if we got any logs back within the time ragne that 
			//	we specified.
			//
			//	WARNING:	the old API was returning 204 to tell that the request
			//				is ok, but there is no data. In the new one you
			//				get 200 no matter what.
			//
			if(body === undefined)
			{
				//
				//	->	Move to the next chain
				//
				return resolve(container);
			}
			
			//
			//	Save the response from CloudFlare for the next Promise, and also
			//	remove any trailing white spaces from the response. 
			//
			//	CloudFlare is bit messy ;)
			//
			container.logs = body.trim();

			//
			//	->	Move to the next chain
			//
			return resolve(container);

		});
	});
}

//
//	Now that we got back the logs, we need to do some conversion to make
//	suer Sumo Logic can ingest this logs. Since Sumo Logic only supports
//	13 digit epoch time; convert original timestamp to a JSON Date object
//
function prepare_data_for_sumo_logic(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Check if CloudFlare actually gives us back something.
		//
		if(container.logs.length == 0)
		{
			//
			//	->	Move to the next chain
			//
			return resolve(container);
		}

		//
		//	2.	Split the string by new line so we get a nice array to work
		//		with
		//
		let logs = container.logs.split('\n');

		//
		//	<>> Log how many entries did we get
		//
		console.log('Log events: ' + logs.length);

		//
		//	Loop over each log entry so we can modify each individual log
		//
		logs.forEach(function(log) {

			//
			//	1.	Convert the line in to a JS object
			//
			let parsed_log = JSON.parse(log);

			//
			//	2.	Sumo Logic only supports 13 digit epoch time; convert
			//		original timestamp to a JSON Date object

			parsed_log.timestamp = parsed_log.timestamp / 1000000;

			//
			//	3.
			//
			if(!!parsed_log.cache)
			{
				if(!!parsed_log.cache.startTimestamp
					&& parsed_log.cache.startTimestamp !== null)
				{
					parsed_log.cache.startTimestamp = parsed_log.cache.startTimestamp / 1000000;
				}

				if(!!parsed_log.cache.endTimestamp
					&& parsed_log.cache.endTimestamp !== null)
				{
					parsed_log.cache.endTimestamp = parsed_log.cache.endTimestamp / 1000000;
				}
			}

			//
			//	4.
			//
			if(!!parsed_log.edge)
			{
				if(!!parsed_log.edge.startTimestamp
					&& parsed_log.edge.startTimestamp !== null)
				{
					parsed_log.edge.startTimestamp = parsed_log.edge.startTimestamp / 1000000;
				}

				if(!!parsed_log.edge.endTimestamp
					&& parsed_log.edge.endTimestamp !== null)
				{
					parsed_log.edge.endTimestamp = parsed_log.edge.endTimestamp / 1000000;
				}
			}

			//
			//	5.
			//
			let metadata_key = sumo_meta_key(container);

			//
			//	6.
			//
			if(metadata_key in container.sumo_logs)
			{
				 container.sumo_logs[metadata_key].push(parsed_log);
			}
			else
			{
				 container.sumo_logs[metadata_key] = [parsed_log];
			}

		});

		//
		//	->	Move to the next chain
		//
		return resolve(container);

	});
}

//
//  After we converted the logs in to a format that Sumo Logic understands,
//  we can safely send it.
//
function pass_logs_to_sumo_logic(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Check if CloudFlare actually gives us back something.
		//
		if(container.logs.length == 0)
		{
			//
			//	->	Move to the next chain.
			//
			return resolve(container);
		}
		
		//
		//  2.  Create an array that will hold all the promies that will push
		//      data to Sumo Logic.
		//
		let tmp = [];
		
		//
		//  3.  Loop over all our groupped data logs.
		//
		for(let key in container.sumo_logs)
		{
		    //
		    //  1.  Prepare a HTTP request promise to our array for later 
		    //      execution.
		    //
		    tmp.push(make_sumo_logic_request(key, container.sumo_logs[key], container.sumo_url));
		}
		
		//
		//  4.  Execute all the HTTP Request and wait for them to finish.
		//
		Promise.all(tmp)
		.then(function() {
		    
		    console.log("Promise All");
		    
		    //
			//	->	Move to the next chain
			//
			return resolve(container);
			
		}).catch(function(error) {
		    
		    return reject(error);
		    
		});


	});
}

//	 ______  _    _  _   _   _____  _______  _____  ____   _   _   _____
//	|  ____|| |  | || \ | | / ____||__   __||_   _|/ __ \ | \ | | / ____|
//	| |__   | |  | ||  \| || |        | |     | | | |  | ||  \| || (___
//	|  __|  | |  | || . ` || |        | |     | | | |  | || . ` | \___ \
//	| |     | |__| || |\  || |____    | |    _| |_| |__| || |\  | ____) |
//	|_|      \____/ |_| \_| \_____|   |_|   |_____|\____/ |_| \_||_____/
//

//
//	Generate a log source string for comparison.
//
function sumo_meta_key(container)
{
	//
	//	1.	Prepare our variable to be populated.
	//
	let source_name = '';
	let source_category = '';
	let source_host = '';

	//
	//	2.
	//
	if(container.source_name_override !== null
		&& container.source_name_override !== ''
		&& container.source_name_override != 'none')
	{
		source_name = container.source_name_override;
	}

	//
	//	3.
	//
	if(container.source_category_override !== null
		&& container.source_category_override !== ''
		&& container.source_category_override != 'none')
	{
		source_category = container.source_category_override;
	}

	//
	//	4.
	//
	if(container.source_host_override !== null
		&& container.source_host_override !== ''
		&& container.source_host_override != 'none')
	{
		source_host = container.source_host_override;
	}

	//
	//	->	Return the result.
	//
	return source_name + ':' + source_category + ':' + source_host;
}

//
//  Each log gorup needs to be sent in a separate request. To do this in a
//  efficint way we take advantage of the ability to execute an array of
//  promises at the "same time". This way all the external request should 
//  more or less finish at the "same" time.
//
function make_sumo_logic_request(key, data, url)
{
	return new Promise(function(resolve, reject) {
	    
	    //
	    //  1.  Extract all the necessary data from the key used to group
	    //      the data.
	    //
        let header_data = key.split(':');
        
		//
		//  2.  Prepare all the options for the request.
		//
		let options = {
			url: url,
			json: true,
			headers: {
				'X-Sumo-Name': header_data[0],
				'X-Sumo-Category': header_data[1],
				'X-Sumo-Host': header_data[2]
			},
			body:  data
		};

		//
		//  -> Execute the request.
		//
		request.post(options, function(error, res, body) {

			//
			//  1.  Check if there was an internal error.
			//
			if(error)
			{
				return reject(error);
			}

			//
			//	2.	Check if got anyting but a positive messages
			//
			if(res.statusCode > 200)
			{
				return reject(new Error("Sumo Logic returned: " + res.statusCode));
			}

			//
			//  ->  Return the promise.
			//
			return resolve();

		});

	});
}