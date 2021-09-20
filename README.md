# ExpressServer
Control the setup process of Express apps services and dependencies.

[![Coverage Status](https://coveralls.io/repos/github/roiperlman/express-server/badge.svg?branch=master)](https://coveralls.io/github/roiperlman/express-server?branch=master)
[![Install Size](https://badgen.net/packagephobia/publish/express-server)](https://packagephobia.com/result?p=express-server)
[![Dependency Count](https://badgen.net/bundlephobia/dependency-count/express-server)](https://badgen.net/bundlephobia/dependency-count/express-server)

## Install
`$ npm install --save express-server-control`

## Usage

```typescript
const expressServer = require('ExpressServer');

export const mainServer = new Server({
  port: 8080,
  name: 'mainServer',
  beforeConfig: [ // An array of function that will run in series before mounting middleware
    // e.g. database connection init, load encryption keys etc.
    // note that functions refferences are passed as arguments and called later by the class 
    loadfKeys,
    initDbConnection,
    //...
  ],
  middleware: [ // middleware mounted with app.use(...)
    // e.g
    compression(),
    cookieParser(),
    // ...
  ],
  tests: [ // a set of tests to run before the server calls app.listen
    // e.g. database connection test
    // see ServerTest class
    testDB()
    //...
  ],
  afterListen: [ // functions that will run in series after app has started listening and 
    // all test were executed successfully.
    InitWebSockets
  ]
});


try {
  // run configuration functions
  await MainServer.config();
  // listen
  await mainServer.listen();
} catch (e) {
  console.error(e);
}


```

### Further information coming soon...
