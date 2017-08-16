using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class PotentialTarget
    {
        private float _projectileSpeed;
        private float _extraOffsetScaler = 1f;

        public PotentialTarget()
        {

        }
        
        public PotentialTarget(Transform target, float projectileSpeed)
        {
            Target = target;
            _projectileSpeed = projectileSpeed;
        }

        [Obsolete("Use transform version instead")]
        public Vector3 LocationInAimedSpace(GameObject thisTurret, Transform aimingObject, bool correctForVelocity = true)
        {
            return LocationInAimedSpace(thisTurret.transform, aimingObject, correctForVelocity);
        }

        public Vector3 LocationInAimedSpace(Transform thisTurret, Transform aimingObject, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? CorrectForVelocity(thisTurret) : Target.transform.position;
            
            return aimingObject == null ? Vector3.zero: aimingObject.transform.InverseTransformPoint(location);
        }


        public float Score { get; set; }
        public Transform Target { get; set; }

        [System.Obsolete("Use Transform version instead")]
        public Vector3 CorrectForVelocity(GameObject thisTurret)
        {
            return CorrectForVelocity(thisTurret.transform);
        }

        public Vector3 CorrectForVelocity(Transform thisTurret)
        {
            var location = Target.position;

            if(_projectileSpeed == 0)
            {
                return location;
            }

            var rigidBody = Target.GetComponent("Rigidbody") as Rigidbody;

            if(rigidBody == null)
            {
                return location;
            }

            var velocity = rigidBody.velocity;

            if(velocity.magnitude == 0){
                return location;
            }

            var distance = DistanceToTurret(thisTurret, false);

            var turretRigidbody = thisTurret.GetComponent("Rigidbody") as Rigidbody;
            velocity = turretRigidbody == null ? velocity : velocity - turretRigidbody.velocity;

            var offsetdistance =  _extraOffsetScaler * distance * velocity / _projectileSpeed;

            //Debug.Log("s=" + distance + "v=" + velocity + ", vp=" + _projectileSpeed + ", aiming " + offsetdistance + " ahead.");

            return location + offsetdistance;
        }

        [System.Obsolete("Use Transform version instead")]
        public float DistanceToTurret(GameObject thisTurret, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? CorrectForVelocity(thisTurret) : Target.position;
            var dist = Vector3.Distance(location, thisTurret.transform.position);
            return dist;
        }

        public float DistanceToTurret(Transform thisTurret, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? CorrectForVelocity(thisTurret) : Target.position;
            var dist = Vector3.Distance(location, thisTurret.transform.position);
            return dist;
        }

        [Obsolete("use transform version instead")]
        public Vector3 LocationInTurretParentSpace(GameObject thisTurret, bool correctForVelocity = true)
        {
            return LocationInTurretParentSpace(thisTurret.transform, correctForVelocity);
        }

        public Vector3 LocationInTurretParentSpace(Transform thisTurret, bool correctForVelocity = true)
        {
            var location = correctForVelocity ? CorrectForVelocity(thisTurret) : Target.transform.position;

            return thisTurret.transform.InverseTransformPoint(location);
        }
    }
}
