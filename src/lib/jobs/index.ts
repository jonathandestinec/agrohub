// Job modules are imported here for their defineJob() side effects. The cron
// route imports this file, so a job only runs if it is listed below.
import "@/modules/banking/job";
import "@/modules/cooperatives/job";
import "@/modules/catalog/job";
import "@/modules/marketplace/job";
