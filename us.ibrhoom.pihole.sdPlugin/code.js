var websocket = null;
var instances = {}

// send some data over the websocket
function send(data){
    websocket.send(JSON.stringify(data));
}

// write to the log
function log(message){
    send({
        "event": "logMessage",
        "payload": {
            "message": message
        }
    });
}

// get auth token from pi-hole API that is valid until 5 min of inactivity
function pihole_connect(settings, handler){
    // If no password is configured, skip auth and return a null session
    if (!settings.ph_key || settings.ph_key.trim() === ""){
        handler({ session: { valid: true, sid: null, validity: 1800 } });
        return;
    }
    let req_addr = `${settings.protocol}://${settings.ph_addr}/api/auth`;
    let xhr = new XMLHttpRequest();
    xhr.timeout = 30000;
    xhr.open("POST", req_addr);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function(){
        let data;
        try {
            data = JSON.parse(xhr.response);
        } catch(e) {
            handler({"error": "bad JSON: " + xhr.response.substring(0, 50)});
            return;
        }
        // Auth failed: v6 returns {"error": {...}} with no session object
        if (!data.session || data.session.valid !== true){
            let hint = data.error ? (data.error.key || data.error.message || "wrong password") : ("HTTP " + xhr.status);
            handler({"error": hint});
            return;
        }
        // No-password instance: sid is null, validity is -1
        if (data.session.sid === null){
            data.session.validity = 1800; // treat as long-lived
        }
        handler(data);
    }
    xhr.onerror = xhr.ontimeout = function(){
        handler({"error": "couldn't authenticate to Pi-hole"});
    }
    xhr.send(JSON.stringify({ password: settings.ph_key }));
}

// delete pi-hole session since API seats are limited
function pihole_end({ settings, session }){
    if (session == null || session.sid == null) return;
    let req_addr = `${settings.protocol}://${settings.ph_addr}/api/auth`;
    let xhr = new XMLHttpRequest();
    xhr.open("DELETE", req_addr);
    xhr.setRequestHeader("X-FTL-SID", session.sid);
    xhr.send();
}

// make a call to check if pi-hole is enabled
function getBlockingStatus(settings, session, handler){
    let req_addr = `${settings.protocol}://${settings.ph_addr}/api/dns/blocking`;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", req_addr);
    if (session && session.sid !== null) xhr.setRequestHeader("X-FTL-SID", session.sid);
    xhr.onload = function(){
        let data = JSON.parse(xhr.response);
        if (data.error) {
            handler({"error": data.error.message || "couldn't reach Pi-hole"});
        } else {
            handler(data);
        }
    }
    xhr.onerror = function(){
        handler({"error": "couldn't reach Pi-hole"});
    }
    xhr.send();
}

// make a call to enable or disable pi-hole
function setBlockingStatus(settings, session, enabled, timer){
    let req_addr = `${settings.protocol}://${settings.ph_addr}/api/dns/blocking`;
    let xhr = new XMLHttpRequest();
    xhr.open("POST", req_addr);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (session && session.sid !== null) xhr.setRequestHeader("X-FTL-SID", session.sid);
    xhr.send(JSON.stringify({ blocking: enabled, timer }));
}

// get stats for the pi-hole (# queries, # clients, etc.) and pass to a handler function
function getStatsSummary(settings, session, handler){
    let req_addr = `${settings.protocol}://${settings.ph_addr}/api/stats/summary`;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", req_addr);
    if (session && session.sid !== null) xhr.setRequestHeader("X-FTL-SID", session.sid);
    xhr.onload = function(){
        let data = JSON.parse(xhr.response);
        if (data.error) {
            handler({"error": data.error.message || "couldn't reach Pi-hole"});
        } else {
            handler(data);
        }
    }
    xhr.onerror = function(){
        handler({"error": "couldn't reach Pi-hole"});
    }
    xhr.send();
}

// helper to normalize blocking value to boolean regardless of API response type
function isBlocking(val){
    if (val === true || val === "enabled") return true;
    if (val === false || val === "disabled") return false;
    return null; // unknown
}
// event handler for us.ibrhoom.pihole.temporarily-disable
function temporarily_disable(context){
    let { settings, session } = instances[context];
    getBlockingStatus(settings, session, response => {
        if (isBlocking(response.blocking) === true){
            setBlockingStatus(settings, session, false, parseInt(settings.disable_time))
        }
    });
}

// event handler for us.ibrhoom.pihole.toggle
function toggle(context){
    let { settings, session } = instances[context];
    getBlockingStatus(settings, session, response => {
        if (isBlocking(response.blocking) === false){
            setBlockingStatus(settings, session, true);
            setState(context, 0);
        }
        else if (isBlocking(response.blocking) === true){
            setBlockingStatus(settings, session, false);
            setState(context, 1);
        }
    });
}

// event handler for us.ibrhoom.pihole.disable
function disable(context){
    let { settings, session } = instances[context];
    setBlockingStatus(settings, session, false);
}

// event handler for us.ibrhoom.pihole.enable
function enable(context){
    let { settings, session } = instances[context];
    setBlockingStatus(settings, session, true);
}

// poll p-h and set the state and button text appropriately
// (called once per second per instance)
function pollPihole(context){
    let { settings, session } = instances[context];
    getBlockingStatus(settings, session, response => {
        // log(`response: ${JSON.stringify(response)}`)
        if ("error" in response){ // couldn't reach p-h, display a warning
            send({
                "event": "sendToPropertyInspector",
                "action": instances[context].action,
                "context": context,
                "payload": { "error": "Network error: " + String(response.error) }
            });
            send({
                "event": "showAlert",
                "context": context
            });
            log(response);
        }
        else{
            // set state according to whether p-h is enabled or disabled
            const blocking = isBlocking(response.blocking);
            if (blocking === false){
                setState(context, 1);
            }
            else if (blocking === true){
                setState(context, 0);
            }
            else {
                // unknown blocking value — show it for debugging
                send({
                    "event": "sendToPropertyInspector",
                    "action": instances[context].action,
                    "context": context,
                    "payload": { "error": "Unknown blocking value: " + JSON.stringify(response.blocking) }
                });
            }

            // display stat, if desired
            if (settings.stat != "none"){
                getStatsSummary(settings, session, response => {
                    // log(`response: ${JSON.stringify(response)}`)
                    if ("error" in response){
                        log(response);
                    }
                    else{
                        // let stat = String(response[settings.stat]);
                        let stat = process_stat(response, settings.stat);
                        // log(stat);
                        send({
                            "event": "setTitle",
                            "context": context,
                            "payload": {
                                "title": stat
                            }
                        });
                    }
                });
            }
        }
    });
}

// process the pi-hole stats to make them more human-readable,
// then cast to string
function process_stat(stats, type){
    switch (type){
        case "domains_being_blocked":
            return stats.gravity.domains_being_blocked.toLocaleString();
        case "dns_queries_today":
            return stats.queries.total.toLocaleString();
        case "ads_blocked_today":
            return stats.queries.blocked.toLocaleString();
        case "ads_percentage_today":
            return stats.queries.percent_blocked.toFixed(2) + "%";
        case "unique_domains":
            return stats.queries.unique_domains.toLocaleString();
        case "queries_forwarded":
            return stats.queries.forwarded.toLocaleString();
        case "queries_cached":
            return stats.queries.cached.toLocaleString();
        case "clients_ever_seen":
            return stats.clients.total.toLocaleString();
        case "unique_clients":
            return stats.clients.active.toLocaleString();
    }
}

// change the state of a button (param "state" should be either 0 or 1)
function setState(context, state){
    let json = {
        "event" : "setState",
        "context" : context,
        "payload" : {
            "state" : state
        }
    };
    websocket.send(JSON.stringify(json));
}

// update the p-h address, API key, or disable time
function updateSettings(payload){
    if ("disable_time" in payload){
        time = payload.disable_time;
    }
    if ("ph_key" in payload){
        ph_key = payload.ph_key;
    }
    if ("ph_addr" in payload){
        ph_addr = payload.ph_addr;
    }
}

// write settings
function writeSettings(context, action, settings){
    // write the settings
    if (!(context in instances)){ 
        instances[context] = {"action": action};
    }
    instances[context].settings = settings;
    if (instances[context].settings.ph_addr == ""){
        instances[context].settings.ph_addr = "pi.hole:8080";
    } else if (!instances[context].settings.ph_addr.includes(":")){
        instances[context].settings.ph_addr += ":8080";
    }
    if (instances[context].settings.stat == "none"){
        send({
            "event": "setTitle",
            "context": context,
            "payload": {
                "title": ""
            }
        });
    }

    // clean up old p-h instance
    if ("poller" in instances[context]){
        clearTimeout(instances[context].poller);
    }
    pihole_end(instances[context]);

    // poll p-h to get status
    instances[context].settings.show_status = true;
    const POLL_INTERVAL_MS = 10000; // 10-second poll — reduces API load and avoids rate limiting

    const onReady = (response) => {
        if ("error" in response){
            // send error to property inspector to display at the bottom
            send({
                "event": "sendToPropertyInspector",
                "action": instances[context].action,
                "context": context,
                "payload": { "error": String(response.error) }
            });
            send({
                "event": "showAlert",
                "context": context
            });
            log(response);
        } else{
            // clear any previous error in the PI
            send({
                "event": "sendToPropertyInspector",
                "action": instances[context].action,
                "context": context,
                "payload": { "error": "" }
            });
            instances[context].session = response.session;
            // Schedule re-auth at half the session validity period (minimum 60s)
            const reAuthMs = Math.max(60, Math.floor((response.session.validity > 0 ? response.session.validity : 1800) / 2)) * 1000;
            instances[context].reAuthAt = Date.now() + reAuthMs;

            // Use setTimeout with jitter instead of setInterval to spread
            // multiple button polls across the interval and avoid hitting
            // the API simultaneously from all buttons
            const jitter = Math.floor(Math.random() * 3000); // 0-3s random offset
            const schedulePoll = () => {
                instances[context].poller = setTimeout(() => {
                    if (!(context in instances)) return; // button removed
                    if (Date.now() >= instances[context].reAuthAt){
                        pihole_end(instances[context]);
                        pihole_connect(instances[context].settings, onReady);
                    } else{
                        pollPihole(context);
                        schedulePoll();
                    }
                }, POLL_INTERVAL_MS + (instances[context]._firstPoll ? jitter : 0));
                instances[context]._firstPoll = false;
            };
            instances[context]._firstPoll = true;
            schedulePoll();
        }
    }
    pihole_connect(instances[context].settings, onReady);
}

// called by the stream deck software when the plugin is initialized
function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo){
    // create the websocket
    websocket = new WebSocket("ws://localhost:" + inPort);
    websocket.onopen = function(){
        // WebSocket is connected, register the plugin
        var json = {
            "event": inRegisterEvent,
            "uuid": inPluginUUID
        };
        websocket.send(JSON.stringify(json));
    };
    websocket.onclose = function(){
        // End all active sessions on disconnect
        for (let ctx in instances){
            if ("poller" in instances[ctx]) clearTimeout(instances[ctx].poller);
            pihole_end(instances[ctx]);
        }
    };

    // message handler
    websocket.onmessage = function(evt){
        let jsonObj = JSON.parse(evt.data);
        let event = jsonObj.event;
        let action = jsonObj.action;
        let context = jsonObj.context;

        // log(`${action} ${event}`);
        // console.log(`${action} ${event}`);

        // update settings for this instance
        if (event == "didReceiveSettings"){
            writeSettings(context, action, jsonObj.payload.settings);
        }

        // apply settings when the action appears
        else if (event == "willAppear"){
            writeSettings(context, action, jsonObj.payload.settings);
        }

        // stop polling and delete settings when the action disappears
        else if (event == "willDisappear"){
            if ("poller" in instances[context]){
                clearTimeout(instances[context].poller);
            }
            pihole_end(instances[context]);
            delete instances[context];
        }

        // handle a keypress
        else if (event == "keyUp"){
            if (action == "us.ibrhoom.pihole.toggle"){
                toggle(context);
            }
            else if (action == "us.ibrhoom.pihole.temporarily-disable"){
                temporarily_disable(context);
            }
            else if (action == "us.ibrhoom.pihole.disable"){
                disable(context);
            }
            else if (action == "us.ibrhoom.pihole.enable"){
                enable(context);
            }
        }
    }
}
