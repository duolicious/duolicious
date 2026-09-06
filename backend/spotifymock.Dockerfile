# Use an official Node.js runtime as a parent image
FROM node:22

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and source
COPY test/spotifymock ./

# Install dependencies
RUN npm install

# Expose the port the app runs on
EXPOSE 3003

# Command to run the app
CMD ["node", "index.js"]
