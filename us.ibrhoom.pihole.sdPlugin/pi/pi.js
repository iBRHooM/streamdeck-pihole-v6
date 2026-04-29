var websocket = null;
var action = null;
var context = null;

// send some data over the websocket
function send(data){
    websocket.send(JSON.stringify(data));
}

// called by the stream deck software when the PI is initialized
function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo){
    websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);
    websocket.onopen = function(){
        send({
            "event" : inRegisterEvent,
            "uuid" : inPropertyInspectorUUID
        });
    }

    websocket.onmessage = function(evt){
        let jsonObj = JSON.parse(evt.data);
        let event = jsonObj.event;
        if (event === "sendToPropertyInspector"){
            const err = jsonObj.payload && jsonObj.payload.error;
            const errDiv = document.querySelector("#error-msg");
            const errText = document.querySelector("#error-text");
            if (err){
                errText.textContent = err;
                errDiv.style.display = "";
            } else {
                errDiv.style.display = "none";
                errText.textContent = "";
            }
        }
    }

    let actionInfo = JSON.parse(inActionInfo);
    action = actionInfo.action;
    context = inPropertyInspectorUUID;

    // hide the "disable time" input if necessary
    if (action != "us.ibrhoom.pihole.temporarily-disable"){
        document.querySelector("#disable-time").style.display = "none";
    }

    // write stored settings to input boxes
    let settings = actionInfo.payload.settings;
    document.querySelector("#ph-key-input").value = settings.ph_key ? settings.ph_key : "";
    document.querySelector("#ph-addr-input").value = settings.ph_addr ? settings.ph_addr : "";
    document.querySelector("#stat-input").value = settings.stat ? settings.stat : "none";
    document.querySelector("#protocol-input").value = settings.protocol ? settings.protocol : "http";
    if (action == "us.ibrhoom.pihole.temporarily-disable"){
        document.querySelector("#disable-time-input").value = settings.disable_time ? settings.disable_time : "";
    }

    // show HTTPS warning if protocol is already set to https
    if (settings.protocol === "https"){
        document.querySelector("#https-warning").style.display = "";
    }
}

function sendToPlugin(payload){
    send({
        "event": "sendToPlugin",
        "action": action,
        "context": context,
        "payload": payload
    });
}

function updateSettings(){
    let key = document.querySelector("#ph-key-input").value;
    let addr = document.querySelector("#ph-addr-input").value;
    let stat = document.querySelector("#stat-input").value;
    let protocol = document.querySelector("#protocol-input").value;

    let payload = {
        "ph_addr" : addr,
        "ph_key" : key,
        "stat" : stat,
        "protocol": protocol
    };

    if (action == "us.ibrhoom.pihole.temporarily-disable"){
        payload.disable_time = document.querySelector("#disable-time-input").value;
    }

    send({
        "event" : "setSettings",
        "context" : context,
        "payload": payload
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#disable-time-input").onchange = updateSettings;
    document.querySelector("#ph-key-input").onchange = updateSettings;
    // also save on Enter key so the password field doesn't clear before saving
    document.querySelector("#ph-key-input").addEventListener("keydown", e => {
        if (e.key === "Enter") updateSettings();
    });
    document.querySelector("#ph-addr-input").onchange = updateSettings;
    document.querySelector("#stat-input").onchange = updateSettings;
    document.querySelector("#protocol-input").onchange = function(){
        const isHttps = this.value === "https";
        document.querySelector("#https-warning").style.display = isHttps ? "" : "none";
        updateSettings();
    };
});
