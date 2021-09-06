import Express from 'express';
import express, {ErrorRequestHandler, RequestHandler} from 'express';
import http from 'http';

// const { EventEmitter as Emitter } = require("events");
import {EventEmitter} from 'events';


/**
 * Express Server
 * Controls the process of configuring and running express application servers with predefined hooks
 */
export class ExpressServer implements ServerSettings {
  // ****** Configuration ***** //
  port: number;
  name: string;
  middleware: Array<RequestHandler | ErrorRequestHandler>;
  beforeConfig: Array<FunctionWithPromise>;
  beforeInit: Array<FunctionWithPromise>;
  afterListen: Array<FunctionWithPromise>;
  tests: Array<ServerTest>;
  runTestsBeforeListening: boolean = false;
  testsRunConfig: TestsRunConfig;
  // ****** Status ***** //
  preConfigRan: boolean = false;
  preInitRan: boolean = false;
  running: boolean = false;
  stopped: boolean = false;
  testsOK: boolean = false;
  // ****** Listen Artifacts ***** //
  application: Express.Application = express();
  httpServer: http.Server;
  /**
   * Emits server events
   */
  serverStatus: EventEmitter;

  /**
   * constructs a new server instance
   * @param settings
   */
  constructor(settings: ServerSettings) {
    this.port = settings.port;
    this.name = settings.name;
    if (settings.middleware) {
      this.middleware = settings.middleware;
    } else {
      this.middleware = [];
    }
    if (settings.beforeConfig) {
      this.beforeConfig = ExpressServer.returnArray<FunctionWithPromise>(settings.beforeConfig);
    }
    if (settings.beforeInit) {
      this.beforeInit = ExpressServer.returnArray<FunctionWithPromise>(settings.beforeInit);
    }
    if (settings.afterListen) {
      this.afterListen = ExpressServer.returnArray<FunctionWithPromise>(settings.afterListen);
    }
    if (settings.tests) {
      this.tests = ExpressServer.returnArray<ServerTest>(settings.tests);
    } else {
      this.testsOK = true;
    }
    if (settings.testsRunConfig) {
      this.testsRunConfig = settings.testsRunConfig;
    } else {
      this.testsRunConfig = {rejectOnError: true, runParallel: true};
    }
    this.runTestsBeforeListening = settings.hasOwnProperty('runTestsBeforeListening') ? settings.runTestsBeforeListening : false;
    this.serverStatus = new EventEmitter();
    return this;
  }

  static runAllFunctions(functions: Array<FunctionWithPromise>, serverInstance?: ExpressServer): Promise<Array<any>> {
    return new Promise(async (resolve, reject) => {
      async function* execute(arr: Array<FunctionWithPromise>) {
        for (let i = 0; i < arr.length; i++) {
          let result;
          try {
            result = await arr[i](serverInstance);
          } catch (err) {
            throw err;
          }
          yield result;
        }
      }

      // run functions
      let runner = execute(functions);
      let results: Array<any> = [];
      let run = true;
      while (run) {
        try {
          let r = await runner.next();
          run = !r.done;
          if (!r.done) {
            results.push(r.value);
          }
        } catch (err) {
          reject(err);
        }
      }
      resolve(results);
    });
  }

  private static returnArray<T>(obj: any): Array<T> {
    if (!obj) {
      return obj
    } else if (!Array.isArray(obj)) {
      return [obj] as Array<T>;
    } else {
      return obj as Array<T>;
    }
  }

  /**
   * mounts middleware in the server with 'use'
   * @param middleware
   */
  mount(middleware: Array<RequestHandler | ErrorRequestHandler> | RequestHandler | ErrorRequestHandler) {
    middleware = ExpressServer.returnArray(middleware);
    middleware.forEach(m => {
      this.use(m);
    })
  }

  /**
   * mounts the middleware defined in the constructor
   */
  async config(): Promise<Array<any>> {
    let beforeConfigResults;
    if (this.beforeConfig) {
      try {
        beforeConfigResults = await ExpressServer.runAllFunctions(this.beforeConfig)
      } catch (err) {
        throw err;
      }
    }

    this.preConfigRan = true;
    try {
      this.mount(this.middleware);
    } catch (err) {
      throw err;
    }
    this.emitStatus();
    return beforeConfigResults;
  }

  /**
   * Run server tests
   * Tests can run in parallel or in series
   * @param config - test configuration
   * @param config.rejectOnError=true - if true will reject promise if one of the tests fails
   * @param config.runParallel=true - if true will run tests in parallel
   */
  async test(config?: TestsRunConfig): Promise<Array<ServerTestResult>> {
    if (this.tests && this.tests.length > 0) {
      console.info('Running server Tests')
      if (!config) {
        config = this.testsRunConfig
      }
      let testResults: Array<ServerTestResult> = [];
      try {
        if (config.runParallel) {
          testResults = await Promise.all<ServerTestResult>(this.tests.map(t => t.execute()))
        } else {
          testResults = await ExpressServer.runAllFunctions(this.tests.map(t => t.execute.bind(t)));
        }
      } catch (err) {
        // rejection not due to test failure
        throw err;
      }
      this.testsOK = testResults.filter(r => !r.error).length === this.tests.length;
      this.emitStatus();
      if (config.rejectOnError && !this.testsOK) {
        throw new Error('Some server tests failed, see log for details');
      }
      return testResults;
    } else {
      // no tests
      this.testsOK = true;
      this.emitStatus();
      return [];
    }
  }

  /**
   * Calls beforeConfig functions if config() didn't run => calls beforeInit functions => calls app.listen(this.port)
   * If runTestsBeforeListening flag is set to true, will run all tests
   * returns an object containing the httpsServer instance created when calling app.listen
   * and an array of results returned from the before init functions.
   * @param port
   */
  listen(port?: number): Promise<{ initResults: Array<any>; httpServer: http.Server }> {
    return new Promise(async (resolve, reject) => {
      if (!port && !this.port) {
        return reject(new Error('Missing port number'));
      }
      // running before config and mounting middleware
      if (!this.preConfigRan) {
        let beforeConfigResults: Array<any>;
        try {
          beforeConfigResults = await this.config();
        } catch (err) {
          return reject(err);
        }
      }

      // Run pre init functions
      let beforeInitResults: Array<any>;
      if (this.beforeInit && !this.preInitRan) {
        try {
          beforeInitResults = await ExpressServer.runAllFunctions(this.beforeInit)
        } catch (err) {
          console.error('there were errors during pre init of server ', this.name);
          return reject(err);
        }
        this.preInitRan = true;
        this.emitStatus();
      }

      // run server tests
      if (this.runTestsBeforeListening) {
        try {
          await this.test();
        } catch (err) {
          return reject(err);
        }
      }

      let p = port ? port : this.port;
      let s = this.application.listen(p, async () => {
        console.log(`App listening on port ${p}`);
        this.httpServer = s;
        this.running = true;
        this.emitStatus();

        // run after listen functions
        if (this.afterListen) {
          try {
            await ExpressServer.runAllFunctions(this.afterListen, this);
          } catch (e) {
            return reject(e);
          }
        }
        resolve({
          initResults: beforeInitResults,
          httpServer: s
        })
      });
    });
  }

  /**
   * Closes the server and stops listening
   */
  close(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        this.httpServer.close((err) => {
          if (err) {
            reject(err)
          } else {
            this.stopped = true;
            this.running = false;
            this.emitStatus();
            resolve(`server ${this.name} was closed successfully`);
          }
        });
      } catch (e) {
        reject(e)
      }
    });
  }

  private use(func: RequestHandler | ErrorRequestHandler) {
    this.application.use(func);
  }

  private emitStatus() {
    this.serverStatus.emit('status', {
      preConfigRan: this.preConfigRan,
      preInitRan: this.preInitRan,
      running: this.running,
      stopped: this.stopped,
      testsOK: this.testsOK
    })
  }
}

/**
 * Test Function for express server
 */
export class ServerTest implements ServerTestConfig {
  onErrorMessage: string;
  onSuccessMessage: string;
  testFunction: FunctionWithPromise<any>;

  constructor(config: ServerTestConfig) {
    this.onErrorMessage = config.onErrorMessage;
    this.onSuccessMessage = config.onSuccessMessage;
    if (config.context) {
      this.testFunction = config.testFunction.bind(context);
    } else {
      this.testFunction = config.testFunction;
    }
  }

  /**
   * run test
   */
  async execute(): Promise<ServerTestResult> {
    let error: any;
    try {
      await this.testFunction()
    } catch (err) {
      error = err;
    }

    let r = {
      error: error,
      errorMessage: error ? this.onErrorMessage : '',
      result: error ? null : this.onSuccessMessage
    }

    if (error) {
      console.error(r.errorMessage)
      console.error(r.error)
    } else {
      console.log(r.result);
    }

    return r;
  }
}

/**
 * Configuration object for a ServerTest instance
 */
export interface ServerTestConfig {
  onErrorMessage: string;
  onSuccessMessage: string;
  testFunction: FunctionWithPromise
  context?: any;
}

/**
 * Configuration object for the Server.test() method
 */
export interface TestsRunConfig {
  rejectOnError: boolean;
  runParallel: boolean
}

/**
 * Configuration object for a Server instance
 */
export interface ServerSettings {
  /**
   * Will be used to call app.listen()
   */
  port: number;
  /**
   * Server Tag Name
   */
  name: string;
  /**
   * Middleware that will be mounted when calling config(), using app.use()
   * To mount routes, use an Express.Router instance
   */
  middleware?: Array<RequestHandler | ErrorRequestHandler>;
  /**
   * Functions to run before mounting middleware
   */
  beforeConfig?: FunctionWithPromise | Array<FunctionWithPromise>;
  /**
   * Functions to run after mounting middleware, before app.listen is called
   */
  beforeInit?: FunctionWithPromise | Array<FunctionWithPromise>;
  /**
   * Functions to run after calling listen
   */
  afterListen?: Array<FunctionWithPromise>;
  /**
   * An array of server test instances, can be ran automatically before calling listen
   */
  tests?: ServerTest | Array<ServerTest>
  /**
   * When set to true, will run all tests before calling listen, and if they all pass will call app.listen
   */
  runTestsBeforeListening?: boolean;
  /**
   * configuration for server test runs
   */
  testsRunConfig?: TestsRunConfig
}

export interface FunctionWithPromise<T = any> extends Function {
  (...args: Array<any>): Promise<T>;
}

/**
 * Result returned from a ServerTestFunction
 */
export interface ServerTestResult {
  result: string;
  error: Error;
  errorMessage: string;
}

/**
 * Event emitted when server status changes
 */
export interface ServerStatusEvent {
  preConfigRan: boolean;
  preInitRan: boolean;
  running: boolean;
  stopped: boolean;
}


