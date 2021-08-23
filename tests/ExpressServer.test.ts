import * as Mocha from 'mocha';
import chai from 'chai';
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
import {expect} from 'chai';
import {FunctionWithPromise, Server, ServerStatusEvent, ServerTest} from '../src'
import before = Mocha.before;
const request = require('supertest');
import {middleware} from "./DefaultMiddleware";
import {NextFunction, Request, Response} from "express";

function resolveIn(ms: number, success: string, error?: Error) {
  return new Promise(async (resolve, reject) => {
    setTimeout(() => {
      if (error) {
        reject(error)
      } else {
        resolve(success);
      }
    }, ms)
  });
}

function echoMiddleware(req: Request, res: Response, next: NextFunction)  {
  res.send(req.body);
}

describe('Server', async function () {
  this.timeout(600000);
  before(function () {
  });
  it('Init An Express with middleware', async function () {
    let m = middleware;
    m.push(echoMiddleware);

    const server = new Server({
      port: 8082,
      name: 'test server',
      middleware: m
    });
    await server.config();
    await server.listen();

    const response = await request(server.application)
      .post('/')
      .send({test: true})
      .expect(200);

    expect(response.body).to.haveOwnProperty('test');
    expect(response.body.test).to.eq(true);
    await server.close();
  });
  it('should run the beforeConfig method', async function () {
    let server = new Server({
      port: 8082,
      name: 'test server',
      middleware: middleware,
      beforeConfig: [
        function() {
          return resolveIn(200, 'before config success');
        }
      ]
    });
    let configResults = await server.config();
    expect(configResults[0]).to.eq('before config success');
    server = new Server({
      port: 8082,
      name: 'test server',
      middleware: middleware,
      beforeConfig: [
        function() {
          return resolveIn(200, 'before config success', new Error('error before config'));
        }
      ]
    });
    await expect(server.config()).to.eventually.be.rejectedWith('error before config');
  });
  it('should run the beforeInit method', async function () {
    let server = new Server({
      port: 8083,
      name: 'test server',
      middleware: middleware,
      beforeInit: [
        function() {
          return resolveIn(200, 'before init success');
        }
      ]
    });
    await server.config();
    let listen = await server.listen();
    expect(listen.initResults[0]).to.eq('before init success');

    server = new Server({
      port: 8082,
      name: 'test server',
      middleware: middleware,
      beforeInit: [
        function() {
          return resolveIn(200, 'before config success', new Error('error before init'));
        }
      ]
    });
    await expect(server.listen()).to.eventually.be.rejectedWith('error before init');
  });
  it('should run the afterListen functions', async function () {
    let name = '';

    let server = new Server({
      port: 8092,
      name: 'test server',
      middleware: middleware,
      beforeInit: [
        function() {
          return resolveIn(200, 'before init success');
        }
      ],
      afterListen: [
        function(serverInstance: Server) {
          return new Promise<void>(async (resolve, reject) => {
            name = serverInstance.name;
            await resolveIn(200, 'before init success');
            resolve();
          });
        }
      ]
    });
    await server.config();
    let listen = await server.listen();
    expect(name).to.eq('test server');
  });
  it('should start and close a server', async function () {
    let m = middleware;
    m.push(echoMiddleware);


    const server = new Server({
      port: 8084,
      name: 'test server',
      middleware: m
    });
    await server.config();
    await server.listen();

    await expect(server.close()).to.eventually.eq(`server ${server.name} was closed successfully`);
  });
  describe('Server status events', async function () {
    // after((done) => {
    //   server.serverStatus.removeAllListeners();
    // })
    let server = new Server({
      port: 8082,
      name: 'test server',
      middleware: middleware,
      beforeConfig: [
        function() {
          return resolveIn(200, 'before config success');
        }
      ]
    });
    it('should emit correct status after config',  function (done) {
      server.serverStatus.on('status', (status: ServerStatusEvent) => {
        expect(status.preConfigRan).to.be.true;
      })

      server.config();

      setTimeout(() => {
        server.serverStatus.removeAllListeners();
        done()
      },2000)

    });
    it('should emit running when calling listen',  function (done) {

      server.serverStatus.on('status', (status: ServerStatusEvent) => {
        expect(status.running).to.be.true;
        expect(status.stopped).to.be.false;
      })
      process.nextTick(async () => {
        server.listen().then().catch();
      })

      setTimeout(() => {
        server.serverStatus.removeAllListeners();
        done()
      },2000)

    });
    it('should emit correct status after stopped', function (done) {
      server.serverStatus.on('status', (status: ServerStatusEvent) => {
        expect(status.stopped).to.be.true;
        expect(status.running).to.be.false;
      })

      server.close().then().catch(done)
      setTimeout(() => {
        done()
      },2000)
    });


  });

  describe('Server Tests', async function () {
    it('should perform server tests', async function () {
      let m = middleware;
      m.push(echoMiddleware);

      const someVar = 12345;

      const server = new Server({
        port: 8084,
        name: 'test server',
        middleware: m,
        tests: [
          new ServerTest({
            onErrorMessage: "test 1 fail",
            onSuccessMessage: "test 1 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var:', someVar)
                setTimeout(resolve, 1000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 2 success",
            onSuccessMessage: "test 2 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var test 2:', someVar)
                setTimeout(resolve, 1000)
              });
            }
          })
        ]
      });

      console.log(await server.test())

    });
    it('should test in series', async function () {
      let m = middleware;
      m.push(echoMiddleware);

      const someVar = 12345;

      const server = new Server({
        port: 8084,
        name: 'test server',
        middleware: m,
        tests: [
          new ServerTest({
            onErrorMessage: "test 1 fail",
            onSuccessMessage: "test 1 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var:', someVar)
                setTimeout(resolve, 1000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 2 success",
            onSuccessMessage: "test 2 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var test 2:', someVar)
                setTimeout(resolve, 2000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 3 success",
            onSuccessMessage: "test 3 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var test 2:', someVar)
                setTimeout(resolve, 1000)
              });
            }
          })
        ]
      });

      console.log(await server.test({rejectOnError: true, runParallel: false}))
    });
    it('should handle test failure', async function () {
      let m = middleware;
      m.push(echoMiddleware);

      const someVar = 12345;

      const server = new Server({
        port: 8084,
        name: 'test server',
        middleware: m,
        tests: [
          new ServerTest({
            onErrorMessage: "test 1 fail",
            onSuccessMessage: "test 1 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var:', someVar)
                setTimeout(resolve, 1000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 2 success",
            onSuccessMessage: "test 2 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var test 2:', someVar)
                setTimeout(resolve, 2000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 3 fail",
            onSuccessMessage: "test 3 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                console.log('some var test 2:', someVar)
                setTimeout(() => {
                  reject(new Error('some Error'))
                }, 1000)
              });
            }
          })
        ]
      });
      await expect(server.test({rejectOnError: true, runParallel: false})).to.eventually.be.rejectedWith('Some server tests failed, see log for details');
    });

  });



  describe('Static Class Methods', function () {
    it('should run an array of functions and return an array of results', async function () {
      let functions: Array<FunctionWithPromise> = [];
      for (let i = 1; i <= 5; i++) {
        functions.push(function () {
          return resolveIn(i * 100, `resolved function ${i}`)
        })
      }

      let results = await Server.runAllFunctions(functions);
      expect(results).to.have.length(functions.length);
      results.forEach((r, i) => {
        expect(r).to.eq(`resolved function ${i+1}`);
      })
    });
    it('should run an array of function and throw an error from one of the functions', async function () {
      let functions: Array<FunctionWithPromise> = [];
      for (let i = 1; i <= 5; i++) {
        functions.push(function () {
          return resolveIn(i * 100, `resolved function ${i}`, i % 2 === 0 ? new Error(`error thrown on function ${i}`) : undefined )
        })
      }
      await expect(Server.runAllFunctions(functions)).to.eventually.be.rejectedWith('error thrown on function 2');
    });
  });
});
