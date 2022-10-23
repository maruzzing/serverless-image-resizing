"use strict";

const AWS = require("aws-sdk");
const querystring = require("querystring");
const Sharp = require("sharp");

const S3 = new AWS.S3({ region: "ap-northeast-2" });
const BUCKET = "image-resizer-origin-s3";

const supportImageTypes = ["jpg", "jpeg", "png", "gif", "webp", "svg", "tiff"];

module.exports.handler = async (event, context, callback) => {
  const { request, response } = event.Records[0].cf;
  const params = querystring.parse(request.querystring);

  // width or height variable is required
  if (!params.w && !params.h) {
    return callback(null, response);
  }

  // extract image from uri
  const { uri } = request;
  const [, imageName, extension] = uri.match(/\/?(.*)\.(.*)/);

  if (!supportImageTypes.some((type) => type === extension)) {
    updateResponse({
      status: 400,
      statusDescription: "Bad Request",
      contentHeader: [{ key: "Content-Type", value: "text/plain" }],
      body: "Unsupported image type",
    });
    return callback(null, response);
  }

  let width;
  let height;
  let format;
  let quality;
  let s3Object;
  let resizedImage;

  // Init sizes.
  width = parseInt(params.w, 10) ? parseInt(params.w, 10) : null;
  height = parseInt(params.h, 10) ? parseInt(params.h, 10) : null;

  // Init quality.
  if (parseInt(params.q, 10)) {
    quality = parseInt(params.q, 10);
  }

  // Init format.
  format = params.f ? params.f : extension;
  format = format === "jpg" ? "jpeg" : format;

  // For AWS CloudWatch.
  console.log(`parmas: ${JSON.stringify(params)}`); // Cannot convert object to primitive value.
  console.log(`name: ${imageName}.${extension}`); // Favicon error, if name is `favicon.ico`.

  try {
    s3Object = await S3.getObject({
      Bucket: BUCKET,
      Key: decodeURI(imageName + "." + extension),
    }).promise();
  } catch (error) {
    console.log("S3.getObject: ", error);
    return callback(error);
  }

  if (s3Object.ContentLength === 0) {
    updateResponse({
      status: 404,
      statusDescription: "Not Found",
      contentHeader: [{ key: "Content-Type", value: "text/plain" }],
      body: "The image does not exist.",
    });
    return callback(null, response);
  }

  try {
    resizedImage = await Sharp(s3Object.Body)
      .resize(width, height)
      .toFormat(format, {
        quality,
      })
      .toBuffer();
  } catch (error) {
    console.log("Sharp: ", error);
    return callback(error);
  }

  const resizedImageByteLength = Buffer.byteLength(resizedImage, "base64");
  console.log("byteLength: ", resizedImageByteLength);

  // `response.body`가 변경된 경우 1MB까지만 허용됨.
  if (resizedImageByteLength >= 1 * 1024 * 1024) {
    return callback(null, response);
  }

  updateResponse({
    status: 200,
    statusDescription: "OK",
    contentHeader: [{ key: "Content-Type", value: `image/${format}` }],
    body: resizedImage.toString("base64"),
    bodyEncoding: "base64",
  });

  return callback(null, response);

  function updateResponse(newResponse) {
    response.status = newResponse.status;
    response.statusDescription = newResponse.statusDescription;
    response.headers["content-type"] = newResponse.contentHeader;
    response.body = newResponse.body;
    if (newResponse.bodyEncoding) {
      response.bodyEncoding = newResponse.bodyEncoding;
    }
    if (newResponse.cacheControl) {
      response.headers["cache-control"] = newResponse.cacheControl;
    }
  }
};
