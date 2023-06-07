const express = require('express');
const app = express()
const port = process.env.PORT || 5000;
require('dotenv').config()

app.get('/', (req, res)=>{
    res.send('Sportopia running')
})
app.listen(port, ()=>{
    console.log('Sportopia running on the port', port);
})