// ===== External Context Module =====
// Gathers weather, time, holidays, and local events for context-aware suggestions

const ExternalContext = (function() {

    // US Holiday Calendar (static for reliability)
    const HOLIDAYS_2026 = [
        { name: "New Year's Day", date: "2026-01-01" },
        { name: "Martin Luther King Jr. Day", date: "2026-01-19" },
        { name: "Valentine's Day", date: "2026-02-14" },
        { name: "Presidents' Day", date: "2026-02-16" },
        { name: "St. Patrick's Day", date: "2026-03-17" },
        { name: "Easter", date: "2026-04-05" },
        { name: "Mother's Day", date: "2026-05-10" },
        { name: "Memorial Day", date: "2026-05-25" },
        { name: "Father's Day", date: "2026-06-21" },
        { name: "Independence Day", date: "2026-07-04" },
        { name: "Labor Day", date: "2026-09-07" },
        { name: "Halloween", date: "2026-10-31" },
        { name: "Veterans Day", date: "2026-11-11" },
        { name: "Thanksgiving", date: "2026-11-26" },
        { name: "Black Friday", date: "2026-11-27" },
        { name: "Cyber Monday", date: "2026-11-30" },
        { name: "Christmas Eve", date: "2026-12-24" },
        { name: "Christmas Day", date: "2026-12-25" },
        { name: "New Year's Eve", date: "2026-12-31" }
    ];

    // Day names for reference
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];

    // Cached data
    let cachedWeather = null;
    let weatherCacheTime = null;
    const WEATHER_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

    /**
     * Gather all external context for an organization
     */
    async function gather(orgData) {
        const now = new Date();

        const [weather, timeContext, holidays] = await Promise.all([
            getWeather(orgData?.city, orgData?.state),
            getTimeContext(now, orgData?.timezone),
            getUpcomingHolidays(now, 30) // Next 30 days
        ]);

        return {
            weather,
            time: timeContext,
            holidays,
            location: {
                city: orgData?.city || null,
                state: orgData?.state || null,
                country: orgData?.country || 'US',
                timezone: orgData?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            gathered_at: now.toISOString()
        };
    }

    /**
     * Get current weather data (with caching)
     */
    async function getWeather(city, state) {
        // Check cache
        if (cachedWeather && weatherCacheTime && (Date.now() - weatherCacheTime < WEATHER_CACHE_DURATION)) {
            return cachedWeather;
        }

        // Default fallback if no location
        if (!city) {
            return {
                available: false,
                reason: 'no_location'
            };
        }

        try {
            // Use OpenWeatherMap API if key is available
            // For now, we'll provide a simplified weather context based on season/time
            const weather = getSeasonalWeatherEstimate(city, state);
            cachedWeather = weather;
            weatherCacheTime = Date.now();
            return weather;
        } catch (error) {
            console.warn('Failed to fetch weather:', error);
            return {
                available: false,
                reason: 'fetch_failed',
                error: error.message
            };
        }
    }

    /**
     * Estimate weather based on season and region (fallback when no API)
     */
    function getSeasonalWeatherEstimate(city, state) {
        const now = new Date();
        const month = now.getMonth();
        const hour = now.getHours();

        // Determine season
        let season;
        if (month >= 2 && month <= 4) season = 'spring';
        else if (month >= 5 && month <= 7) season = 'summer';
        else if (month >= 8 && month <= 10) season = 'fall';
        else season = 'winter';

        // Regional adjustments (simplified)
        const northernStates = ['WA', 'OR', 'MT', 'ND', 'MN', 'WI', 'MI', 'NY', 'VT', 'NH', 'ME', 'MA'];
        const southernStates = ['FL', 'GA', 'SC', 'AL', 'MS', 'LA', 'TX', 'AZ', 'NM'];
        const isNorth = northernStates.includes(state);
        const isSouth = southernStates.includes(state);

        // Estimate temperature range
        let tempEstimate;
        let conditions;

        switch (season) {
            case 'winter':
                tempEstimate = isSouth ? { low: 45, high: 65 } : isNorth ? { low: 15, high: 35 } : { low: 25, high: 45 };
                conditions = isNorth ? 'cold_possible_snow' : 'cool';
                break;
            case 'spring':
                tempEstimate = isSouth ? { low: 55, high: 75 } : isNorth ? { low: 40, high: 60 } : { low: 45, high: 65 };
                conditions = 'mild_possible_rain';
                break;
            case 'summer':
                tempEstimate = isSouth ? { low: 75, high: 95 } : isNorth ? { low: 60, high: 80 } : { low: 65, high: 85 };
                conditions = isSouth ? 'hot' : 'warm';
                break;
            case 'fall':
                tempEstimate = isSouth ? { low: 55, high: 75 } : isNorth ? { low: 35, high: 55 } : { low: 45, high: 65 };
                conditions = 'cool_crisp';
                break;
        }

        // Time of day consideration
        const isDaytime = hour >= 7 && hour <= 19;
        const currentTemp = isDaytime
            ? Math.round((tempEstimate.low + tempEstimate.high) / 2 + 5)
            : Math.round((tempEstimate.low + tempEstimate.high) / 2 - 5);

        return {
            available: true,
            estimated: true, // Flag that this is estimated, not real-time
            current: {
                temp: currentTemp,
                feels_like: currentTemp,
                conditions: conditions,
                description: getWeatherDescription(conditions, isDaytime)
            },
            forecast: {
                season: season,
                temp_range: tempEstimate
            },
            location: { city, state }
        };
    }

    /**
     * Get human-readable weather description
     */
    function getWeatherDescription(conditions, isDaytime) {
        const descriptions = {
            'cold_possible_snow': isDaytime ? 'Cold with possible snow' : 'Cold night, possible snow',
            'cool': isDaytime ? 'Cool and pleasant' : 'Cool night',
            'mild_possible_rain': isDaytime ? 'Mild with possible showers' : 'Mild night, chance of rain',
            'warm': isDaytime ? 'Warm and pleasant' : 'Warm evening',
            'hot': isDaytime ? 'Hot and sunny' : 'Warm night',
            'cool_crisp': isDaytime ? 'Cool and crisp' : 'Cool, crisp night'
        };
        return descriptions[conditions] || 'Pleasant';
    }

    /**
     * Get time-based context
     */
    function getTimeContext(now, timezone) {
        const dayOfWeek = now.getDay();
        const hour = now.getHours();
        const minute = now.getMinutes();

        // Time of day classification
        let timeOfDay;
        if (hour >= 5 && hour < 12) timeOfDay = 'morning';
        else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
        else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
        else timeOfDay = 'night';

        // Business context
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isLunchHour = hour >= 11 && hour <= 14;
        const isHappyHour = hour >= 16 && hour <= 19 && !isWeekend;
        const isDinnerTime = hour >= 17 && hour <= 21;
        const isLateNight = hour >= 21 || hour < 5;

        // Week position
        const isMonday = dayOfWeek === 1;
        const isFriday = dayOfWeek === 5;
        const isEndOfMonth = now.getDate() >= 28;
        const isStartOfMonth = now.getDate() <= 3;

        return {
            dayOfWeek: dayOfWeek,
            dayName: DAY_NAMES[dayOfWeek],
            hour: hour,
            minute: minute,
            timeOfDay: timeOfDay,
            isWeekend: isWeekend,
            isWeekday: !isWeekend,
            isMonday: isMonday,
            isFriday: isFriday,
            isLunchHour: isLunchHour,
            isHappyHour: isHappyHour,
            isDinnerTime: isDinnerTime,
            isLateNight: isLateNight,
            isEndOfMonth: isEndOfMonth,
            isStartOfMonth: isStartOfMonth,
            month: now.getMonth(),
            monthName: MONTH_NAMES[now.getMonth()],
            date: now.getDate(),
            year: now.getFullYear(),
            timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }

    /**
     * Get upcoming holidays within specified days
     */
    function getUpcomingHolidays(fromDate, daysAhead = 30) {
        const now = new Date(fromDate);
        const futureLimit = new Date(now);
        futureLimit.setDate(futureLimit.getDate() + daysAhead);

        const upcoming = [];

        for (const holiday of HOLIDAYS_2026) {
            const holidayDate = new Date(holiday.date);
            if (holidayDate >= now && holidayDate <= futureLimit) {
                const daysAway = Math.ceil((holidayDate - now) / (1000 * 60 * 60 * 24));
                upcoming.push({
                    name: holiday.name,
                    date: holiday.date,
                    daysAway: daysAway,
                    isToday: daysAway === 0,
                    isTomorrow: daysAway === 1,
                    isThisWeek: daysAway <= 7
                });
            }
        }

        return upcoming.sort((a, b) => a.daysAway - b.daysAway);
    }

    /**
     * Check if today is a holiday
     */
    function isHolidayToday() {
        const today = new Date().toISOString().split('T')[0];
        return HOLIDAYS_2026.find(h => h.date === today) || null;
    }

    /**
     * Get context-based suggestions based on external factors
     */
    function getSuggestions(context) {
        const suggestions = [];
        const { weather, time, holidays, location } = context;

        // Weather-based suggestions
        if (weather?.available) {
            if (weather.current?.conditions === 'cold_possible_snow') {
                suggestions.push({
                    type: 'weather',
                    trigger: 'cold_weather',
                    suggestion: 'Consider a "warm up" promotion - hot drinks discount or cozy indoor specials',
                    urgency: 'immediate'
                });
            }
            if (weather.current?.conditions === 'hot') {
                suggestions.push({
                    type: 'weather',
                    trigger: 'hot_weather',
                    suggestion: 'Push cold drinks, refreshments, or "beat the heat" specials',
                    urgency: 'immediate'
                });
            }
        }

        // Time-based suggestions
        if (time) {
            if (time.isFriday && time.isHappyHour) {
                suggestions.push({
                    type: 'time',
                    trigger: 'friday_happy_hour',
                    suggestion: 'Friday happy hour window - prime time for weekend kickoff promos',
                    urgency: 'within_hour'
                });
            }
            if (time.isMonday && time.timeOfDay === 'morning') {
                suggestions.push({
                    type: 'time',
                    trigger: 'monday_morning',
                    suggestion: 'Monday motivation - consider a "start the week" loyalty bonus',
                    urgency: 'today'
                });
            }
            if (time.isEndOfMonth) {
                suggestions.push({
                    type: 'time',
                    trigger: 'end_of_month',
                    suggestion: 'End of month - customers may have budget to spend before reset',
                    urgency: 'this_week'
                });
            }
        }

        // Holiday-based suggestions
        if (holidays && holidays.length > 0) {
            const nextHoliday = holidays[0];
            if (nextHoliday.daysAway <= 7) {
                suggestions.push({
                    type: 'holiday',
                    trigger: nextHoliday.name.toLowerCase().replace(/[^a-z]/g, '_'),
                    holiday: nextHoliday.name,
                    daysAway: nextHoliday.daysAway,
                    suggestion: `${nextHoliday.name} is ${nextHoliday.isToday ? 'today' : nextHoliday.isTomorrow ? 'tomorrow' : `in ${nextHoliday.daysAway} days`} - time for themed promotions!`,
                    urgency: nextHoliday.daysAway <= 2 ? 'immediate' : 'this_week'
                });
            }
        }

        return suggestions;
    }

    /**
     * Format context for AI prompt injection
     */
    function formatForPrompt(context) {
        const lines = [];
        const { weather, time, holidays, location } = context;

        // Weather line
        if (weather?.available) {
            lines.push(`Weather: ${weather.current?.description || 'Unknown'}, ${weather.current?.temp}°F${weather.estimated ? ' (estimated)' : ''}`);
        }

        // Time line
        if (time) {
            lines.push(`Time: ${time.dayName} ${time.timeOfDay} (${time.hour}:${String(time.minute).padStart(2, '0')})`);
            if (time.isHappyHour) lines.push(`Context: Happy hour window`);
            if (time.isLunchHour) lines.push(`Context: Lunch hour`);
        }

        // Upcoming holidays
        if (holidays && holidays.length > 0) {
            const holidayList = holidays.slice(0, 3).map(h =>
                `${h.name} (${h.isToday ? 'today' : h.isTomorrow ? 'tomorrow' : `${h.daysAway}d`})`
            ).join(', ');
            lines.push(`Upcoming: ${holidayList}`);
        }

        // Location
        if (location?.city) {
            lines.push(`Location: ${location.city}, ${location.state || location.country}`);
        }

        return lines.join('\n');
    }

    // Public API
    return {
        gather,
        getWeather,
        getTimeContext,
        getUpcomingHolidays,
        isHolidayToday,
        getSuggestions,
        formatForPrompt,
        HOLIDAYS_2026,
        DAY_NAMES,
        MONTH_NAMES
    };

})();

// Make available globally
window.ExternalContext = ExternalContext;
