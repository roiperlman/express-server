import * as Mocha from 'mocha';
import chai from 'chai';
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
import {expect} from 'chai';
import {FunctionWithPromise, ExpressServer, ServerStatusEvent, ServerTest} from '../src'
import before = Mocha.before;
const request = require('supertest');
import {middleware} from "./DefaultMiddleware";
import {NextFunction, Request, Response} from "express";
const rewire = require("rewire");

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
  const servers: Array<ExpressServer> = [];
  this.timeout(600000);
  const ports: Array<number> = []
  const numberOfTest = 200;
  function getPort() {
    return ports.shift();
  }
  before(function (done) {
    let p = 8080;
    for (let i = 0; i < numberOfTest; i++) {
      ports.push(p + i);
    }
    return done();
  });
  it('Init An Express Server with middleware', async function () {
    let m = middleware;
    m.push(echoMiddleware);

    const server = new ExpressServer({
      port: getPort(),
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
    let server = new ExpressServer({
      port: getPort(),
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
    server = new ExpressServer({
      port: getPort(),
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
  it('should throw error when port is not defined', async function () {
    let server = new ExpressServer({
      port: undefined,
      name: 'test server',
      middleware: middleware,
      beforeConfig: [
        function() {
          return resolveIn(200, 'before config success');
        }
      ]
    });
    await expect(server.listen()).to.eventually.be.rejectedWith('Missing port number');
  });
  it('should throw error when trying to close a server that is already closed', async function () {
    let server = new ExpressServer({
      port: getPort(),
      name: 'test server',
      middleware: middleware,
      beforeConfig: []
    });
    await server.listen();
    expect(server.httpServer).to.not.be.undefined;
    await server.close();
    await expect(server.close()).to.eventually.be.rejectedWith('Server is not running.');

  });
  it('should throw error when trying to close a server that was not started', async function () {
    let server = new ExpressServer({
      port: getPort(),
      name: 'test server',
      middleware: middleware,
      beforeConfig: []
    });
    expect(server.httpServer).to.be.undefined;
    await expect(server.close()).to.eventually.be.rejectedWith("Cannot read");
  });
  it('should run the beforeInit method', async function () {
    let server1 = new ExpressServer({
      port: 9999,
      name: 'test server',
      middleware: middleware,
      beforeInit: [
        function() {
          return resolveIn(200, 'before init success');
        }
      ]
    });
    await server1.config();
    let listen = await server1.listen();
    expect(listen.initResults[0]).to.eq('before init success');

    const server2 = new ExpressServer({
      port: getPort(),
      name: 'test server',
      middleware: middleware,
      beforeInit: [
        function() {
          return resolveIn(200, 'before config success', new Error('error before init'));
        }
      ]
    });
    await expect(server2.listen()).to.eventually.be.rejectedWith('error before init');
    await server1.close()
  });
  it('should run the afterListen functions', async function () {
    let name = '';

    let server = new ExpressServer({
      port: getPort(),
      name: 'test server',
      middleware: middleware,
      beforeInit: [
        function() {
          return resolveIn(200, 'before init success');
        }
      ],
      afterListen: [
        function(serverInstance: ExpressServer) {
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
    await server.close();
  });
  it('should start and close a server', async function () {
    let m = middleware;
    m.push(echoMiddleware);


    const server = new ExpressServer({
      port: getPort(),
      name: 'test server',
      middleware: m
    });
    await server.config();
    await server.listen();

    await expect(server.close()).to.eventually.eq(`server ${server.name} was closed successfully`);
  });
  describe('Server status events', async function () {
    let server: ExpressServer;
    after((done) => {
      server.serverStatus.removeAllListeners();
      done();
    })
    before( function(done) {
      server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: middleware,
        beforeConfig: [
          function() {
            return resolveIn(200, 'before config success');
          }
        ]
      });

      done();
    });

    it('should emit correct status after config',  function (done) {
      server.serverStatus.on('status', (status: ServerStatusEvent) => {
        expect(status.preConfigRan).to.be.true;
      })
      server.config().then(() => {
        setTimeout(() => {
          done()
        },500)
      }).catch(done)
    });
    it('should emit running when calling listen',  function (done) {
      server.serverStatus.on('status', (status: ServerStatusEvent) => {
        expect(status.running).to.be.true;
        expect(status.stopped).to.be.false;
      })
      server.listen().then(() => {
        setTimeout(() => {
          server.serverStatus.removeAllListeners();
          done()
        },2000)
      }).catch(done)

    });
    it('should emit correct status after stopped', function (done) {
      server.serverStatus.on('status', (status: ServerStatusEvent) => {
        expect(status.stopped).to.be.true;
        expect(status.running).to.be.false;
      })

      server.close().then(() => {
        setTimeout(() => {
          done()
        },500)
      }).catch(done)

    });


  });
  describe('Handle hooks errors', async function () {
    it('should handle beforeConfig Error', async function () {
      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: [],
        beforeConfig: [
          () => {
            return Promise.reject('some error');
          }
        ]
      });
      await expect(server.config()).to.eventually.be.rejectedWith('some error')
      await expect(server.listen()).to.eventually.be.rejectedWith('some error')
      expect(server.httpServer).to.be.a('undefined');
    });
    it('should handle beforeInit Error', async function () {
      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: [],
        beforeInit: [
          () => {
            return Promise.reject('some error');
          }
        ]
      });
      await expect(server.listen()).to.eventually.be.rejectedWith('some error')
      expect(server.httpServer).to.be.a('undefined');
    });
    it('should handle afterListen Error', async function () {
      const p = getPort();
      const server = new ExpressServer({
        port: undefined,
        name: 'test server',
        afterListen: [
          () => {
            return Promise.reject('some error');
          }
        ]
      });
      await expect(server.listen(p)).to.eventually.be.rejectedWith('some error')
      await server.close();
    });
    it('should handle tests errors before listening', async function () {
      const p = getPort();
      const server = new ExpressServer({
        port: p,
        name: 'test server',
        middleware: [],
        tests: [
          new ServerTest({
            testFunction: () => {
              return Promise.reject('some error');
            },
            onErrorMessage: 'some message',
            onSuccessMessage: 'success'
          })
        ],
        runTestsBeforeListening: true
      });
      await expect(server.listen(p)).to.eventually.be.rejectedWith('Some server tests failed, see log for details')
      expect(server.httpServer).to.be.a('undefined');
    });
    it('should handle mount Error', async function () {
      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: [
          null
        ],
      });
      await expect(server.config()).to.eventually.be.rejectedWith('app.use() requires a middleware function')
    });
  });
  describe('Server Tests', async function () {
    it('should initiate server with tests run configuration', async function () {
      let server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: middleware,
        beforeConfig: [
          function() {
            return resolveIn(200, 'before config success');
          }
        ],
        testsRunConfig: {
          rejectOnError: false,
          runParallel: false
        }
      });
      expect(server.testsRunConfig.runParallel).to.be.false;
      expect(server.testsRunConfig.rejectOnError).to.be.false;
    });
    it('should perform server tests', async function () {
      let m = middleware;
      m.push(echoMiddleware);

      let someVar = 1;

      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: m,
        tests: [
          new ServerTest({
            onErrorMessage: "test 1 fail",
            onSuccessMessage: "test 1 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                someVar++;
                setTimeout(resolve, 1000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 2 success",
            onSuccessMessage: "test 2 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                someVar++;
                setTimeout(resolve, 1000)
              });
            }
          })
        ]
      });

      await expect(server.test()).to.eventually.have.length(2);
      expect(someVar).to.equal(3);

    });
    it('should test in series', async function () {
      let m = middleware;
      m.push(echoMiddleware);

      let someVar = 1;

      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: m,
        tests: [
          new ServerTest({
            onErrorMessage: "test 1 fail",
            onSuccessMessage: "test 1 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                someVar++;
                setTimeout(resolve, 1000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 2 success",
            onSuccessMessage: "test 2 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                someVar++;
                setTimeout(resolve, 2000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 3 success",
            onSuccessMessage: "test 3 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                someVar++;
                setTimeout(resolve, 1000)
              });
            }
          })
        ]
      });
      await expect(server.test({rejectOnError: true, runParallel: false}))
        .to.eventually.have.length(3);
      expect(someVar).to.equal(4);
    });
    it('should handle test failure', async function () {
      let m = middleware;
      m.push(echoMiddleware);

      const someVar = 12345;

      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: m,
        tests: [
          new ServerTest({
            onErrorMessage: "test 1 fail",
            onSuccessMessage: "test 1 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                setTimeout(resolve, 1000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 2 success",
            onSuccessMessage: "test 2 fail",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
                setTimeout(resolve, 2000)
              });
            }
          }),
          new ServerTest({
            onErrorMessage: "test 3 fail",
            onSuccessMessage: "test 3 success",
            testFunction: () => {
              return new Promise(async (resolve, reject) => {
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
    it('should reject not due to server test rejection', async function () {
      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        middleware: [],
        tests: [
          null
        ],
        runTestsBeforeListening: true
      });
      await expect(server.test()).to.eventually.be.rejectedWith('Cannot read property \'execute\' of null');
    });
    it('should return an empty array when no tests were defined', async function () {
      const server = new ExpressServer({
        port: getPort(),
        name: 'test server',
        tests: [],
        runTestsBeforeListening: true
      });
      await expect(server.test())
        .to.eventually.be.an('array')
        .that.has.length(0);
    });

    describe('Running test with custom this argument', async function () {
      it('should perform server tests', async function () {

        let someVar = 1;
        let assignFromContext = '';
        let assignFromDefaultThis: any;

        const server = new ExpressServer({
          port: getPort(),
          name: 'test server',
          tests: [
            new ServerTest({
              onErrorMessage: "test 1 fail",
              onSuccessMessage: "test 1 success",
              testFunction: function () {
                return new Promise(async (resolve, reject) => {
                  someVar++;
                  assignFromDefaultThis = this.onErrorMessage;
                  setTimeout(resolve, 1000)
                });
              }
            }),
            new ServerTest({
              onErrorMessage: "test 2 success",
              onSuccessMessage: "test 2 fail",
              testFunction: () => {
                return new Promise(async (resolve, reject) => {
                  someVar++;
                  assignFromContext = this.test.title;
                  setTimeout(resolve, 1000)
                });
              },
              context: this
            })
          ]
        });

        await server.test();
        expect(assignFromDefaultThis).to.eq("test 1 fail");
        expect(assignFromContext).to.eq('should perform server tests');
      });
    })


  });
  describe('Static Class Methods', function () {
    it('should always return an array', async function () {
      const S = rewire('../src/index.ts').ExpressServer;
      expect(S.returnArray([1,2,3])).to.be.an('array').that.has.length(3);
      expect(S.returnArray(1)).to.be.an('array').that.has.length(1);
      expect(S.returnArray(null)).to.be.null;

    });
    it('should run an array of functions and return an array of results', async function () {
      let functions: Array<FunctionWithPromise> = [];
      for (let i = 1; i <= 5; i++) {
        functions.push(function () {
          return resolveIn(i * 100, `resolved function ${i}`)
        })
      }

      let results = await ExpressServer.runAllFunctions(functions);
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
      await expect(ExpressServer.runAllFunctions(functions)).to.eventually.be.rejectedWith('error thrown on function 2');
    });

  });
});
