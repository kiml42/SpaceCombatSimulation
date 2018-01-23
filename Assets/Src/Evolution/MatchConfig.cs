using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class MatchConfig
    {
        private static readonly Vector3[] _startVector =
        {
            new Vector3(-1,0,0),
            new Vector3(1,0,0),
            new Vector3(0,-1,0),
            new Vector3(0,1,0),
            new Vector3(0,0,-1),
            new Vector3(0,0,1)
        };

        public int Id;

        public float MatchTimeout = 20;

        /// <summary>
        /// Number of seconds between winner polls
        /// </summary>
        public float WinnerPollPeriod = 2;

        /// <summary>
        /// Initial distance between competitors
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
        
        public int CompetitorsPerTeam = 1;

        /// <summary>
        /// proportion of the distance to the centre to start subsequent competitors
        /// </summary>
        public float StepForwardProportion = 0.5f;
        
        public float[] LocationRandomisationRadiai = { 0 };
        public string LocationRandomisationRadiaiString {
            get
            {
                return string.Join(",", LocationRandomisationRadiai.Select(r => r.ToString()).ToArray());
            }
            set
            {
                if (string.IsNullOrEmpty(value))
                {
                    LocationRandomisationRadiai = new float[] { 0 };
                } else
                {
                    LocationRandomisationRadiai = value.Split(',').Where(s => !string.IsNullOrEmpty(s)).Select(s => float.Parse(s)).ToArray();
                }
            }
        }

        public bool RandomiseRotation = true;

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

        public float? Budget { get; set; }

        /// <summary>
        /// Returns the start position for the competitior with the given index.
        /// </summary>
        /// <param name="index"></param>
        /// <param name="stepsTowardsCentre">number of increments of the step forward proportion to use</param>
        /// <returns></returns>
        public Vector3 PositionForCompetitor(int index, float stepsTowardsCentre = 0)
        {
            var stepForwards = stepsTowardsCentre * StepForwardProportion * InitialRange; 

            var distanceToCentre = (InitialRange - stepForwards) / 2;

            var randomisation = Random.insideUnitSphere * GetLocationRandomisationRadius(index);

            var randomisedLocation = (_startVector[index % _startVector.Length] * distanceToCentre) + randomisation;

            return randomisedLocation;
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

        private float GetLocationRandomisationRadius(int index)
        {
            if (!LocationRandomisationRadiai.Any())
            {
                throw new System.Exception("The LocationRandomisationRadiai list is empty.");
            }

            return LocationRandomisationRadiai[index % LocationRandomisationRadiai.Length];
        }

        private Vector3 GetStartLocationVector(int index)
        {
            if (!_startVector.Any())
            {
                throw new System.Exception("The _startVector list is empty.");
            }

            return _startVector[index % _startVector.Length];
        }
    }
}
