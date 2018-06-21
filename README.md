# CloudFlare To SumoLogic

This repository grabs the logs from CloudFlare groups them and converts the time format for Sumo Logic to ingest. 

# Deploy this stack

<a target="_blank" href="https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=Cloudflare-to-SumoLogic&templateURL=https://s3.us-east-2.amazonaws.com/net.security7.cloudformations/Cloudflare-to-SumoLogic.json">
<img align="left" style="float: left; margin: 0 10px 0 0;" src="https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png"></a>

To deploy this solution just click the button found at the beginning of this sentence, and follow the instructions that CloudFormation provides in your AWS Dashboard.

**ATTENTION**: In the section `Capabilities`, remember to check `I acknowledge that AWS CloudFormation might create IAM resources with custom names.`. This deployment needs to create **IAM Roles** for this stack to work properly.

# More about us

[Security7](https://www.security7.net/) is a group of security professionals that strive to make security: affordable, scalable and reliable. If you'd like to get in touch with use, go to our [contact](https://www.security7.net/contact/) page.
