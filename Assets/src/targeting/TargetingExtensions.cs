using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public static class TargetingExtensions
    {
        public static Vector3 LocationInTurnTableSpace(this PotentialTarget target, Rigidbody turnTable, float? projectileSpeed)
        {
            return target.TargetRigidbody.LocationInTurnTableSpace(turnTable, projectileSpeed);
        }

        public static Vector3 LocationInElevationHubSpace(this PotentialTarget target, Rigidbody elevationHub, float? projectileSpeed)
        {
            return target.TargetRigidbody.LocationInElevationHubSpace(elevationHub, projectileSpeed);
        }

        public static Vector3 LocationInElevationHubSpaceAfterTurnTableTurn(this PotentialTarget target, Rigidbody thisTurret, Transform turnTable, Rigidbody elevationHub, float? projectileSpeed)
        {
            return target.TargetRigidbody.LocationInElevationHubSpaceAfterTurnTableTurn(thisTurret, turnTable, elevationHub, projectileSpeed);
        }
        
        public static Vector3 LocationInAimedSpace(this PotentialTarget target, Rigidbody aimingObject, float? projectileSpeed)
        {
            return target.TargetRigidbody.LocationInAimedSpace(aimingObject, projectileSpeed);
        }
        
        public static Vector3 CorrectForVelocity(this PotentialTarget target, Rigidbody baseObject, float? projectileSpeed)
        {
            return target.TargetRigidbody.CorrectForVelocity(baseObject, projectileSpeed);
        }

        /// <summary>
        /// Returns the distance to the target from the given Rigidbody.
        /// Returns float.MaxValue if the target or turret Rigidbody is null.
        /// </summary>
        /// <param name="target"></param>
        /// <param name="thisTurret"></param>
        /// <param name="projectileSpeed"></param>
        /// <returns></returns>
        public static float DistanceToTurret(this PotentialTarget target, Rigidbody thisTurret, float? projectileSpeed)
        {
            return target.TargetRigidbody.DistanceToTurret(thisTurret, projectileSpeed);
        }

        public static Vector3 LocationInOtherTransformSpace(this PotentialTarget target, Rigidbody otherTransform, float? projectileSpeed)
        {
            return target.TargetRigidbody.LocationInOtherTransformSpace(otherTransform, projectileSpeed);
        }

        public static Vector3 LocationInTurnTableSpace(this Rigidbody target, Rigidbody turnTable, float? projectileSpeed)
        {
            if (turnTable == null)
            {
                return Vector3.zero;
            }
            var location = target.CorrectForVelocity(turnTable, projectileSpeed);

            return turnTable.transform.InverseTransformPoint(location);
        }

        public static Vector3 LocationInElevationHubSpace(this Rigidbody target, Rigidbody elevationHub, float? projectileSpeed)
        {
            var location = target.CorrectForVelocity(elevationHub, projectileSpeed);

            if (elevationHub == null)
            {
                return Vector3.zero;
            }

            return elevationHub.transform.InverseTransformPoint(location);
        }

        public static Vector3 LocationInElevationHubSpaceAfterTurnTableTurn(this Rigidbody target, Rigidbody thisTurret, Transform turnTable, Rigidbody elevationHub, float? projectileSpeed)
        {
            if (turnTable == null || elevationHub == null)
            {
                return Vector3.zero;
            }

            var location = target.CorrectForVelocity(thisTurret, projectileSpeed);

            //Debug.Log("WorldLocation Now: " + location);
            location = turnTable.InverseTransformPoint(location);
            //Debug.Log("LocationInTurnTableSpace Now: " + location);

            var elevation = location.y;

            location.y = 0;

            var distance = location.magnitude;

            var effectiveLocation = new Vector3(0, elevation, distance);
            //Debug.Log("effectiveLocation: " + effectiveLocation);

            var locationInWorldSpace = turnTable.TransformPoint(effectiveLocation);
            //Debug.Log("locationInWorldSpace: " + locationInWorldSpace);

            //Debug.Log("EffectiveLocation in hub space: " + ElevationHub.transform.InverseTransformPoint(locationInWorldSpace));

            return elevationHub.transform.InverseTransformPoint(locationInWorldSpace);
        }

        public static Vector3 LocationInAimedSpace(this Rigidbody potentialTarget, Rigidbody aimingObject, float? projectileSpeed)
        {
            var location = potentialTarget.CorrectForVelocity(aimingObject, projectileSpeed);

            return aimingObject == null ? Vector3.zero : aimingObject.transform.InverseTransformPoint(location);
        }


        public static Vector3 CorrectForVelocity(this Rigidbody potentialTarget, Rigidbody baseObject, float? projectileSpeed)
        {
            var location = potentialTarget.position;

            if (!projectileSpeed.HasValue || projectileSpeed.Value == 0)
            {
                return location;
            }

            var projectileSpeedValue = projectileSpeed.Value;

            var velocity = potentialTarget.velocity;

            var distance = potentialTarget.DistanceToTurret(baseObject, null);

            velocity = baseObject == null ? velocity : velocity - baseObject.velocity;

            var offsetdistance = distance * velocity / projectileSpeedValue;

            //Debug.Log("s=" + distance + "v=" + velocity + ", vp=" + _projectileSpeed + ", aiming " + offsetdistance + " ahead.");

            return location + offsetdistance;
        }

        /// <summary>
        /// Returns the distance to the target from the given Rigidbody.
        /// Returns float.MaxValue if the target or turret Rigidbody is null.
        /// </summary>
        /// <param name="target"></param>
        /// <param name="thisTurret"></param>
        /// <param name="projectileSpeed"></param>
        /// <returns></returns>
        public static float DistanceToTurret(this Rigidbody target, Rigidbody thisTurret, float? projectileSpeed)
        {
            if(target == null || thisTurret == null)
            {
                return float.MaxValue;
            }
            var location = target.CorrectForVelocity(thisTurret, projectileSpeed);
            var dist = Vector3.Distance(location, thisTurret.position);
            return dist;
        }

        public static Vector3 LocationInOtherTransformSpace(this Rigidbody potentialTarget, Rigidbody otherTransform, float? projectileSpeed)
        {
            var location = potentialTarget.CorrectForVelocity(otherTransform, projectileSpeed);

            return otherTransform.transform.InverseTransformPoint(location);
        }
    }
}
