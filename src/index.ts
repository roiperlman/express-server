import Express, {RequestHandler, ErrorRequestHandler, Application} from 'express';
import express from 'express';
import http from 'http';

// const { EventEmitter as Emitter } = require("events");
import {EventEmitter} from 'events';


/**
 * Wrapper for Express Application Server
 */
export class Server implements ServerSettings {
  port: number;
  name: string;
  middleware: Array<RequestHandler|ErrorRequestHandler>;
  beforeConfig: Array<FunctionWithPromise>;
  beforeInit: Array<FunctionWithPromise>;
  tests: Array<ServerTest>;
  runTestsBeforeListening: boolean = false;
  // ****** Status ***** //
  preConfigRan: boolean = false;
  preInitRan: boolean = false;
  running: boolean = false;
  stopped: boolean = false;
  testsOK: boolean = false;
  // ********* //
  application: Express.Application = express();
  httpServer: http.Server;
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
    }
    if (settings.beforeConfig) {
      this.beforeConfig = Server.returnArray<FunctionWithPromise>(settings.beforeConfig);
    }
    if (settings.beforeInit) {
      this.beforeInit = Server.returnArray<FunctionWithPromise>(settings.beforeInit);
    }
    if (settings.tests) {
      this.tests = Server.returnArray<ServerTest>(settings.tests);
    } else {
      this.testsOK = true;
    }
    this.runTestsBeforeListening = settings.hasOwnProperty('runTestsBeforeListening') ? settings.runTestsBeforeListening : false;
    this.serverStatus = new EventEmitter();
    return this;
  }

  /**
   * mounts middleware in the server with 'use'
   * @param middleware
   */
  mount(middleware: Array<RequestHandler|ErrorRequestHandler>|RequestHandler|ErrorRequestHandler) {
    middleware = Server.returnArray(middleware);
    middleware.forEach(m => {
      this.use(m);
    })
  }

  private use(func: RequestHandler|ErrorRequestHandler) {
    this.application.use(func);
  }

  /**
   * mounts the middleware defined in the constructor
   */
  config(): Promise<Array<any>> {
    return new Promise(async (resolve, reject) => {
      let beforeConfigResults;
      if (this.beforeConfig) {
        try {
          beforeConfigResults = await Server.runAllFunctions(this.beforeConfig)
        } catch (err) {
          return reject(err);
        }
      }

      this.preConfigRan = true;
      try {
        this.mount(this.middleware);
      } catch (err) {
        return reject(err);
      }
      this.emitStatus();
      resolve(beforeConfigResults);
    });
  }

  /**
   * run server tests
   * @param config - test configuration
   * @param config.rejectOnError=true - if true will reject promise if one of the tests fails
   * @param config.runParallel=true - if true will run tests in parallel
   */
  test(config: {rejectOnError: boolean; runParallel: boolean} = {rejectOnError: true, runParallel: true}): Promise<Array<ServerTestResult>> {
    return new Promise(async (resolve, reject) => {
      if (this.tests) {
        console.info('Running server Tests')
        let testResults: Array<ServerTestResult> = [];
        try {
          if (config.runParallel) {
            testResults = await Promise.all<ServerTestResult>(this.tests.map(t => t.execute()))
          } else {
            testResults = await Server.runAllFunctions(this.tests.map(t => t.execute.bind(t)));
            console.log(testResults)
          }
        } catch (err) {
          // rejection not due to test failure
          return reject(err);
        }
        this.testsOK = testResults.filter(r => !r.error).length === this.tests.length;
        this.emitStatus();
        if (config.rejectOnError && !this.testsOK) {
          reject(new Error('Some server tests failed, see log for details'))
        }
        resolve(testResults);
      } else {
        resolve([])
      }
    });
  }

  /**
   * starts listening
   * @param port
   */
  listen(port?: number): Promise<{initResults: Array<any>; httpServer: http.Server}> {
    return new Promise(async (resolve, reject) => {
      // running before config and mounting middleware
      if (!this.preConfigRan) {
        let beforeConfigResults: Array<any>;
        try {
          beforeConfigResults = await this.config();
        } catch (err) {
          reject(err);
        }
      }

      // Run pre init functions
      let beforeInitResults: Array<any>;
      if (this.beforeInit && !this.preInitRan) {
        try {
          beforeInitResults = await Server.runAllFunctions(this.beforeInit)
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
          reject(err);
        }
      }

      let p = port ? port : this.port;
      let s = this.application.listen(p, async () => {
        console.log(`app listening on port ${p}`);
        this.httpServer = s;
        this.running = true;
        this.emitStatus();

        resolve({
          initResults: beforeInitResults,
          httpServer: s
        })
      });
    });
  }

  /**
   * closes the server and stops listening
   */
  close(): Promise<string> {
    return new Promise(async (resolve, reject) => {
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
    });
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

  static runAllFunctions(functions: Array<FunctionWithPromise>): Promise<Array<any>> {
    return new Promise(async (resolve, reject) => {
      async function* execute(arr: Array<FunctionWithPromise>) {
        for (let i = 0; i < arr.length; i++) {
          let result;
          try {
            result = await arr[i]();
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
          run  = !r.done;
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

    execute(): Promise<ServerTestResult> {
      return new Promise(async (resolve, reject) => {
        let error: Error;
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

        if(error) {
          console.error(r.errorMessage)
          console.error(r.error)
        } else {
          console.log(r.result);
        }

        resolve(r)

      });
    }
}
export interface ServerTestConfig {
  onErrorMessage: string;
  onSuccessMessage: string;
  testFunction: FunctionWithPromise
  context?: any;
}

export interface ServerSettings {
  port: number;
  name: string;
  middleware?: Array<RequestHandler|ErrorRequestHandler>;
  beforeConfig?: FunctionWithPromise | Array<FunctionWithPromise>;
  beforeInit?: FunctionWithPromise | Array<FunctionWithPromise>;
  tests?: ServerTest | Array<ServerTest>
  runTestsBeforeListening?: boolean;
}

export interface FunctionWithPromise<T = any> extends Function {
  (...args: Array<any>): Promise<T>;
}


export interface ServerTestResult {
  result: string;
  error: Error;
  errorMessage: string;
}
export interface ServerTestFunction {
  (...args: Array<any>): Promise<ServerTestResult>
}


export interface ServerStatusEvent {
  preConfigRan: boolean;
  preInitRan: boolean;
  running: boolean;
  stopped: boolean;
}


