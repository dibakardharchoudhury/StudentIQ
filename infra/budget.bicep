targetScope = 'resourceGroup'

param notificationEmail string
param monthlyAmount int = 50
param startDate string = '2026-11-01T00:00:00Z'
param endDate string = '2027-11-01T00:00:00Z'

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'studentiq-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: endDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [notificationEmail]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [notificationEmail]
      }
    }
  }
}
