using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Turret
{
    public static class TurretTargetExtensions
    {
        public static Vector3 LocationInTurnTableSpace(this PotentialTarget target, Rigidbody turnTable, bool correctForVelocity = true)
        {
            if(turnTable == null)
            {
                return Vector3.zero;
            }
            var location = correctForVelocity ? target.CorrectForVelocity(turnTable) : target.Target.transform.position;
            
            return turnTable.transform.InverseTransformPoint(location);
        }

        public static Vector3 LocationInElevationHubSpace(this PotentialTarget target, Rigidbody elevationHub, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? target.CorrectForVelocity(elevationHub) : target.Target.transform.position;

            if(elevationHub == null)
            {
                return Vector3.zero;
            }

            return elevationHub.transform.InverseTransformPoint(location);
        }

        public static Vector3 LocationInElevationHubSpaceAfterTurnTableTurn(this PotentialTarget target, Rigidbody thisTurret, Transform turnTable, Rigidbody elevationHub, bool correctForVelocity = true)
        {
            if(turnTable == null || elevationHub == null)
            {
                return Vector3.zero;
            }

            var location = correctForVelocity ? target.CorrectForVelocity(thisTurret) : target.Target.transform.position;

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
    }
}
