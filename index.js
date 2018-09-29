const apiai = require("apiai");
const express = require("express");
const app =express()
const request = require('request')
const bodyParser = require("body-parser");
const uuid = require("uuid");
const axios = require('axios');


/** send this payload on 
 * https://graph.facebook.com/v3.0/me/messenger_profile?access_token=your_tOKEN
 * {
  "get_started": {"payload": "FACEBOOK_WELCOME"}
   }
 */
//Import Config file
const config = require("./config");

//serve static files in the public directory
app.use(express.static("public"));

// Process application/x-www-form-urlencoded
app.use(
  bodyParser.urlencoded({
    extended: false
  })
);

// Process application/json
app.use(bodyParser.json());

// Index route
app.get("/", function (req, res) {
  res.send("Hello world, I am a chat bot");
});

// for Facebook verification
app.get("/webhook/", function (req, res) {
  console.log("request");
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === config.FB_VERIFY_TOKEN
  ) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});

// Spin up the server
app.listen(process.env.PORT || 5000, function () {
    console.log("Magic Started on port=>5000");
});

const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
  language: "en",
  requestSource: "fb"
});
const sessionIds = new Map();

// Message processing
app.post('/webhook', function (req, res) {
    console.log(req.body);
    var data = req.body;
  
    // Make sure this is a page subscription
    if (data.object === 'page') {
      
      // Iterate over each entry - there may be multiple if batched
      data.entry.forEach(function(pageEntry) {
        var pageID = pageEntry.id;
        var timeOfEvent = pageEntry.time;
  
        // Iterate over each messaging event
        pageEntry.messaging.forEach(function(messagingEvent) {
          if (messagingEvent.message) {
            receivedMessage(messagingEvent);
          } else if (messagingEvent.postback) {
            receivedPostback(messagingEvent);   
          } else {
            console.log("Webhook received unknown event: ", messagingEvent);
          }
        });
      });
  
      // Assume all went well.
      //
      // You must send back a 200, within 20 seconds, to let us know
      // you've successfully received the callback. Otherwise, the request
      // will time out and we will keep trying to resend.
      res.sendStatus(200);
    }
  });

  // Incoming events handling
  function receivedMessage(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;
  
    if (!sessionIds.has(senderID)) {
      sessionIds.set(senderID, uuid.v1());
    }
  
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;
  
    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
  
    if (messageText) {
      //send message to api.ai
      sendToApiAi(senderID, messageText);
    } else if (messageAttachments) {
      handleMessageAttachments(messageAttachments, senderID);
    }
  }

  function sendToApiAi(sender, text) {
    sendTypingOn(sender);
    let apiaiRequest = apiAiService.textRequest(text, {
      sessionId: sessionIds.get(sender)
    });
  
    apiaiRequest.on("response", response => {
      if (isDefined(response.result)) {
        handleApiAiResponse(sender, response);
      }
    });
  
    apiaiRequest.on("error", error => console.error(error));
    apiaiRequest.end();
  }

  /*
 * Turn typing indicator on
 *
 */
const sendTypingOn = (recipientId) => {
  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };
  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
const callSendAPI = async (messageData) => {

  const url = "https://graph.facebook.com/v3.0/me/messages?access_token=" + config.FB_PAGE_TOKEN;
    await axios.post(url, messageData)
      .then(function (response) {
        if (response.status == 200) {
          var recipientId = response.data.recipient_id;
          var messageId = response.data.message_id;
          if (messageId) {
            console.log(
              "Successfully sent message with id %s to recipient %s",
              messageId,
              recipientId
            );
          } else {
            console.log(
              "Successfully called Send API for recipient %s",
              recipientId
            );
          }
        }
      })
      .catch(function (error) {
        console.log(error.response.headers);
      });
  }

  const isDefined = (obj) => {
    if (typeof obj == "undefined") {
      return false;
    }
    if (!obj) {
      return false;
    }
    return obj != null;
  }

  function handleApiAiResponse(sender, response) {
    let responseText = response.result.fulfillment.speech;
    let responseData = response.result.fulfillment.data;
    let messages = response.result.fulfillment.messages;
    let action = response.result.action;
    let contexts = response.result.contexts;
    let parameters = response.result.parameters;
  
    sendTypingOff(sender);
  
   if (responseText == "" && !isDefined(action)) {
      //api ai could not evaluate input.
      console.log("Unknown query" + response.result.resolvedQuery);
      sendTextMessage(
        sender,
        "I'm not sure what you want. Can you be more specific?"
      );
    } else if (isDefined(action)) {
      handleApiAiAction(sender, action, responseText, contexts, parameters);
    } else if (isDefined(responseData) && isDefined(responseData.facebook)) {
      try {
        console.log("Response as formatted message" + responseData.facebook);
        sendTextMessage(sender, responseData.facebook);
      } catch (err) {
        sendTextMessage(sender, err.message);
      }
    } else if (isDefined(responseText)) {
      sendTextMessage(sender, responseText);
    }
  }

  /*
 * Turn typing indicator off
 *
 */
const sendTypingOff = (recipientId) => {
  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}

const sendTextMessage = async (recipientId, text) => {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: text
    }
  };
  await callSendAPI(messageData);
}


function handleApiAiAction(sender, action, responseText, contexts, parameters) {
  switch (action) {
   case "send-joke":
      request({
        uri: "https://icanhazdadjoke.com/",
        json: true

      },(error,response,body)=>{
        if(!error && response.statusCode == 200){
            sendTextMessage(sender, body.joke);
        }
      });
      break;
   case "send-joke-more":
      request({
        uri: "https://icanhazdadjoke.com/",
        json: true

      },(error,response,body)=>{
        if(!error && response.statusCode == 200){
            sendTextMessage(sender, body.joke);
        }
      });
      break;
    //  var responseText = "This is example of Text message."
    //  sendTextMessage(sender, responseText);
    //  break;
   default:
     //unhandled action, just send back the text
   sendTextMessage(sender, responseText);
 }
}

function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;
    request({
      uri: "https://graph.facebook.com/v3.0/" + senderID,
      qs: {
        access_token: config.FB_PAGE_TOKEN
      }
    },(error,response,body)=>{
      if(!error && response.statusCode == 200){
        let user = JSON.parse(body);
        let responseText = `Welcome, ${user.first_name} ${user.last_name}`;
        sendTextMessage(senderID, responseText);
      }
    });
}

  

