using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class MatchConfig
    {
        public float MatchTimeout = 300;

        /// <summary>
        /// Number of seconds between winner polls
        /// </summary>
        public float WinnerPollPeriod = 2;

        /// <summary>
        /// Initial distance to the centre
        /// </summary>
        public float InitialRange = 6000;

        /// <summary>
        /// Start speed of each competitor towards the centre
        /// </summary>
        public float InitialSpeed = 0;

        /// <summary>
        /// additional initial speed up to this magnitude in a random direction
        /// </summary>
        public float RandomInitialSpeed = 0;
        
        public float MaximumLocationRandomisation = 50;
        public float MinimumLocationRandomisation = 0;

        public int CompetitorsPerTeam = 1;

        /// <summary>
        /// proportion of the distance to the centre to start subsequent competitors
        /// </summary>
        public float StepForwardProportion = 0.5f;
        
        public bool RandomiseRotation = false;

        public int[] AllowedModuleIndicies = null;
        public string AllowedModulesString {
            get
            {
                if (AllowedModuleIndicies != null && AllowedModuleIndicies.Any())
                {
                    return string.Join(",", AllowedModuleIndicies.Select(r => r.ToString()).ToArray());
                }
                return null;
            }
            set
            {
                AllowedModuleIndicies = value.Split(',').Where(s => !string.IsNullOrEmpty(s)).Select(s => int.Parse(s)).ToArray();
            }
        }

        public float? Budget = 1000;

        /// <summary>
        /// Returns the start position for the competitior with the given spawnPointNumber.
        /// </summary>
        /// <param name="spawnPointNumber"></param>
        /// <param name="totalSpawnPoints"></param>
        /// <param name="stepsForwards">Power to raise the StepForwardProportion to</param>
        /// <returns></returns>
        public Vector3 PositionForCompetitor(int spawnPointNumber, int totalSpawnPoints, float stepsForwards = 0)
        {
            var distanceToCentre = Mathf.Pow(StepForwardProportion, stepsForwards) * InitialRange;

            var angle = spawnPointNumber * (2 * Mathf.PI / (totalSpawnPoints));

            var x = Mathf.Cos(angle) * distanceToCentre;
            var z = Mathf.Sin(angle) * distanceToCentre;
            var baseLocation = new Vector3(x, 0, z);

            var randomisedLocation = baseLocation + RandomLocation();

            return randomisedLocation;
        }

        /// <summary>
        /// Returns a random location between the spheres at max and min distance.
        /// Values will be evenly distributed in distance and in angle from the centre, not volumetrically.
        /// </summary>
        /// <returns></returns>
        public Vector3 RandomLocation()
        {
            return RandomLocation(MinimumLocationRandomisation, MaximumLocationRandomisation);
        }
        
        /// <summary>
        /// Returns a random location between the spheres at max and min distance.
        /// Values will be evenly distributed in distance and in angle from the centre, not volumetrically.
        /// </summary>
        /// <returns></returns>
        public Vector3 RandomLocation(float minimumRadius, float MaximumRadius = 0)
        {
            var randomMagnitude = Random.Range(
                    minimumRadius,
                    MaximumRadius
                );
            var orientation = Random.onUnitSphere;

            return randomMagnitude * orientation;
        }

        /// <summary>
        /// Returns the appropriate orientation for a ship starting at the given location.
        /// This orientation will be pointing at the centre, unless RandomiseRotation is true.
        /// </summary>
        /// <param name="startLocation"></param>
        /// <returns></returns>
        public Quaternion OrientationForStartLocation(Vector3 startLocation)
        {
            return RandomiseRotation ? Random.rotation : Quaternion.LookRotation(-startLocation);
        }

        /// <summary>
        /// Returns a velocity for a ship starting at the given location.
        /// This velocity will have a magnitude of InitialSpeed towards the centre + a random component scaled by RandomInitialSpeed
        /// </summary>
        /// <param name="startLocation"></param>
        /// <returns></returns>
        public Vector3 VelocityForStartLocation(Vector3 startLocation)
        {
            var v = (InitialSpeed * -startLocation.normalized) + Random.insideUnitSphere * RandomInitialSpeed;
            //Debug.Log(v);
            return v;
        }

        //private float GetLocationRandomisationRadius(int index)
        //{
        //    if (!LocationRandomisationRadiai.Any())
        //    {
        //        throw new System.Exception("The LocationRandomisationRadiai list is empty.");
        //    }

        //    return LocationRandomisationRadiai[index % LocationRandomisationRadiai.Length];
        //}

        //private Vector3 GetStartLocationVector(int index)
        //{
        //    if (!_startVector.Any())
        //    {
        //        throw new System.Exception("The _startVector list is empty.");
        //    }

        //    return _startVector[index % _startVector.Length];
        //}
    }
}
