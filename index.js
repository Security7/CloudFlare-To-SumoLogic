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
		req: event,
		//
		//	Save all the env variable.
		//
		sumo_url               	 : process.env.SUMO_ENDPOINT,
		zone_id                  : process.env.CLOUDFLARE_ZONE_ID,
		cloudflare_auth_email    : process.env.CLOUDFLARE_AUTH_EMAIL,
		cloudflare_auth_key      : process.env.CLOUDFLARE_AUTH_KEY,
		cloudflare_fields   	 : process.env.CLOUDFLARE_FIELDS,
		source_name_override     : process.env.SOURCE_NAME_OVERRIDE 	||	process.env.CLOUDFLARE_ZONE_ID,
		source_category_override : process.env.SOURCE_CATEGORY_OVERRIDE || 	'none',
		source_host_override     : process.env.SOURCE_HOST_OVERRIDE 	|| 	'api.cloudflare.com',
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
		res: event
	};

	//
	//	->	Start the chain.
	//
	try 
	{
		container = await time_calculation(container);
		container = await request_logs(container);
		container = await split_new_line(container);
		container = await check_for_time_presence(container);
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
	return container.res;
	
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
		//	3.	Set the start time based on the end time
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
				fields: container.cloudflare_fields
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
			//	2.	Check if we got any logs back within the time ragne that 
			//		we specified.
			//
			//		WARNING:	the old API was returning 204 to tell that the 
			//					request is ok, but there is no data. In the new 
			//					one you get 200 no matter what.
			//
			if(body === undefined)
			{
				//
				//	->	Move to the next chain, despitne not having evrything
				//		since the subsequnet promises will check if there
				//		is data or not.
				//
				return resolve(container);
			}
			
			//
			//	3.	Check if we are makign to many requests
			//
			if(res.statusCode == 429)
			{
				return reject(new Error("Too Many Requests"));
			}
			
			//
			//	4.	Save the response from CloudFlare for the next Promise, and 
			//		also remove any trailing white spaces from the response. 
			//
			//		CloudFlare is bit messy ;)
			//
			container.raw_logs = body.trim();
	
			//
			//	->	Move to the next chain
			//
			return resolve(container);

		});
	});
}

//
//	Get the raw logs, which are just one big string, and use the new line
//	character to split each log in to an array, this way all the subsequent 
//	promises can work with the data.
//
function split_new_line(container)
{
	return new Promise(function(resolve, reject) {
		
		//
		//	1.	Check if CloudFlare actually gives us back something.
		//
		if(container.raw_logs.length == 0)
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
		container.logs = container.raw_logs.split('\n');
		
		//
		//	<>> Log how many entries did we get
		//
		console.log("Log events: ", container.logs.length);
		
		//
		//	->	Move to the next chain
		//
		return resolve(container);
		
	});
}

//
//	CloudFront allows you to decide which files to return back. For Sumo Logic
//	to be any use for you we need to send the start and end time of a request.
//
//		- EdgeStartTimestamp
//		- EdgeEndTimestamp
//
//	This promise will check for thie two values, and will thrw an error if
//	they are missing.
//
function check_for_time_presence(container)
{
	return new Promise(function(resolve, reject) {
		
		//
		//	1.	This array will hold which key is missing
		//
		let what_is_missing = [];

		//
		//	2.	Parse just the first key since all of them will have the same
		//		exact structure.
		//
		let log = JSON.parse(container.logs[0]);
		
		//
		//	3.	Check to see if we missing the Start time
		//
		if(!log.EdgeStartTimestamp)
		{
			what_is_missing.push("Start");
		}
		
		//
		//	4.	Check to see if we missing the End time
		//
		if(!log.EdgeEndTimestamp)
		{
			what_is_missing.push("End");
		}
		
		//
		//	5.	Check if one of the previus checks added an item to the array
		//
		if(what_is_missing.length)
		{
			//
			//	1.	Join the errors in to a single string
			//
			let missing = what_is_missing.join(', ');
			
			//
			//	2.	Create the error message
			//
			let error = new Error("WARNING: " + missing + " time is missing");
			
			//
			//	->	Stop the execution of the chain and surface the error
			//
			return reject(error);
		}
		
		//
		//	->	Move to the next chain
		//
		return resolve(container);
		
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
		//	1.	Loop over each log entry so we can modify each individual log
		//
		container.logs.forEach(function(log) {
			
			//
			//	1.	Convert the line in to a JS object
			//
			let parsed_log = JSON.parse(log);

			//
			//	2.
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
			//	3.	Change the order of the elements in the object becasue 
			//		Sumo will generally select the timestamp that appears 
			//		"furthest left" in the message. 		
			//
			let reorganized_logs = time_log_reorder(parsed_log); 

			//
			//	4.
			//
			let metadata_key = sumo_meta_key(container);

			//
			//	5.	Check if we have a key already in our object, and if so we 
			//		just push to the array new data. Or, we crate a new array
			//		for that particular key
			//
			if(metadata_key in container.sumo_logs)
			{
				 container.sumo_logs[metadata_key].push(reorganized_logs);
			}
			else
			{
				 container.sumo_logs[metadata_key] = [reorganized_logs];
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
		//  1.  Create an array that will hold all the promies that will push
		//      data to Sumo Logic.
		//
		let tmp = [];
		
		//
		//  2.  Loop over all our groupped data logs.
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
		//  3.  Execute all the HTTP Request and wait for them to finish.
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

//
//	This function was created to sort the CloudFront log and make sure that the
//	EdgeStartTimestamp and EdgeEndTimestamp are at the top of the object,
//	while making sure that EdgeStartTimestamp is always the first element.
//
//	This is done because Sumo Logic will take the first time stamp in a log
//	and use that to represent when the log was actually "created".
//
function time_log_reorder(obj)
{
	//
	//  1.  Create a new variable that will hold our new sorted object
	//
	let tmp = {};

	//
	//  2.  Loop over the whole object in search for the first key that needs
	//      to be as the first key in the object
	//
	for(let key in obj)
	{
		if(key == 'EdgeStartTimestamp')
		{
			tmp[key] = obj[key];
		}
	}

	//
	//  3.  Then look for the next most important key that needs to be at the
	//      top of the key.
	//
	for(let key in obj)
	{
		if(key == 'EdgeEndTimestamp')
		{
			tmp[key] = obj[key];
			break;
		}
	}

	//
	//  4.  Once we have what we were looking fore, we loop the last time
	//      over the original object and add the rest of the keys while
	//      skipping what we have already
	//
	//
	for(let key in obj)
	{
		if((key != 'EdgeStartTimestamp') || (key != 'EdgeEndTimestamp'))
		{
			tmp[key] = obj[key];
			break;
		}
	}

	//
	//  ->  Return the re-ordered object.
	//
	return tmp;
}