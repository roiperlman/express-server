import compression from 'compression';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import * as fileUpload from 'express-fileupload'

export const middleware = [
  compression(),
  morgan(process.env.NODE_ENV ? process.env.NODE_ENV : 'development'),
  bodyParser.urlencoded({extended:true}),
  bodyParser.json({limit : '20mb'}),
  bodyParser.json({ type: 'application/vnd.api+json' }),
  fileUpload.default()
];

