#!/bin/bash

#     _____  ______  _______  _______  _____  _   _   _____   _____
#    / ____||  ____||__   __||__   __||_   _|| \ | | / ____| / ____|
#   | (___  | |__      | |      | |     | |  |  \| || |  __ | (___
#    \___ \ |  __|     | |      | |     | |  | . ` || | |_ | \___ \
#    ____) || |____    | |      | |    _| |_ | |\  || |__| | ____) |
#   |_____/ |______|   |_|      |_|   |_____||_| \_| \_____||_____/
#

#
#   Get working dir.
#
LOCAL=$(pwd);

#
#   Use basename to get the the name fo the folder where we are running
#   and use that as the name for our files.
#
ARCHIVE_NAME=$(basename $LOCAL);

#
#   Create an array with all the AWS Regions that we can support this way
#   clients can deploy our solution in their own region.
#   
#   Missing:    China and Japan since you need to have a special AWS account 
#               for thoes.
#
REGIONS=(
    us-east-2 us-east-1 us-west-1 us-west-2 
    ap-south-1 ap-northeast-2 
    ap-southeast-1 ap-southeast-2 ap-northeast-1 
    ca-central-1
    eu-central-1 eu-west-1 eu-west-2 eu-west-3 
    sa-east-1
);

#    __  __              _____   _   _
#   |  \/  |     /\     |_   _| | \ | |
#   | \  / |    /  \      | |   |  \| |
#   | |\/| |   / /\ \     | |   | . ` |
#   | |  | |  / ____ \   _| |_  | |\  |
#   |_|  |_| /_/    \_\ |_____| |_| \_|
#

#
#   <>> UI information.
#
echo "Starting by checking if we have all te S3 buckets in place";
echo "";

#
#   Loop over the AWS Region array and check if we have to create a bucket
#   in a region that dosn't have our code.
#
for ((i=0; i < ${#REGIONS[@]}; i++));
do
    #
    #   Create the bucket name based on the region.
    #
    BUCKET=net.security7.code."${REGIONS[$i]}";
    
    #
    #   <>> UI information.
    #
    echo "Checking if $BUCKET exists.";

    #
    #   Check if the bucket dose not exists.
    #
    if ! aws s3 ls | tail -n +1 | grep -q "$BUCKET"; then
    
        #
        #   <>> UI information.
        #
        echo "  Creating bucket $BUCKET.";
        
        #
        #   Create the bucket if is missing.
        #
        aws s3 mb s3://$BUCKET --region ${REGIONS[$i]} > /dev/null;
        
    fi
done

#
#   <>> UI information.
#
echo "";
echo "All the S3 buckets are in place.";

#
#   Check if there is a npm config file.
#
if [ -e package.json ]; then

    #
    #   <>> UI information.
    #
    echo "";
    echo "Running: npm install.";
    
    #
    #   Install all the NodeJS modules while supressing the output to reduce
    #   noise.
    #
    npm install 2>&1 > /dev/null;

fi

#
#   Check if a node modules exists.
#
if [ -d node_modules ]; then

    #
    #   <>> UI information.
    #
    echo "";
    echo "Touching: node_modules to update thier data.";

    #
    #   For whatever reason after the npm install command some files that
    #   get pulled have a date way back in the past: like 1985.
    #
    #   The following command will touch any file created in the past to
    #   let the system update the data of those files.
    #
    find ./node_modules -mtime +10950 -exec touch {} \;

fi

#
#   <>> UI information.
#
echo "";
echo "Zipping: $ARCHIVE_NAME.zip.";

#
#  Archive the repo.
#
zip -r -q $LOCAL/$ARCHIVE_NAME .;

#
#   <>> UI information.
#
echo "";
echo "Uploading: $ARCHIVE_NAME.zip.";
echo "";

#
#   Loop again aver all the regions and upload the source code in all the 
#   regions that we support.
#
for ((i=0; i < ${#REGIONS[@]}; i++));
do

    #
    #   Create the bucket name based on the region.
    #
    BUCKET=net.security7.code."${REGIONS[$i]}";
    
    #
    #   Upload the ZIP file.
    #
    aws s3 cp $ARCHIVE_NAME.zip s3://$BUCKET/$ARCHIVE_NAME.zip;
    
done

#
#   <>> UI information.
#
echo "";
echo "Deleteing: $ARCHIVE_NAME.zip.";
    
#
#   Delete the ZIP file name to keep a clean work environment.
#
rm $ARCHIVE_NAME.zip

#
#   <>> UI information.
#
echo "";
echo "Done!";