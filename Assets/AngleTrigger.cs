using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class AngleTrigger : MonoBehaviour, IFireControl
{
    public Rigidbody AimingObject;
    public float ShootAngle = 10;
    public bool AvoidFriendlyFire = true;
    public float FriendlyDetectionDistance = 20;
    public float MinFriendlyDetectionDistance = 0.5f;

    private IKnowsCurrentTarget _targetChoosingMechanism;
    private float? _projectileSpeed;

    // Use this for initialization
    void Start ()
    {
        var speedKnower = GetComponent("IKnowsProjectileSpeed") as IKnowsProjectileSpeed;
        _targetChoosingMechanism = GetComponent("IKnowsCurrentTarget") as IKnowsCurrentTarget;
        _projectileSpeed = speedKnower != null ? speedKnower.ProjectileSpeed : null;
    }

    public bool ShouldShoot(Target target)
    {
        if (AvoidFriendlyFire)
        {
            //Debug.Log("looking for friendlies");
            RaycastHit hit;
            var ray = new Ray(AimingObject.position + (AimingObject.transform.forward * MinFriendlyDetectionDistance), AimingObject.transform.forward);
            if (Physics.Raycast(ray, out hit, FriendlyDetectionDistance, -1, QueryTriggerInteraction.Ignore))
            {
                //Debug.Log(hit.transform);
                //is a hit
                if (hit.transform.tag == tag)
                {
                    //Debug.Log("Is friendly, so don't shoot.");
                    //is aimed at a friendly
                    return false;
                }
            }
        }
        if (target != null)
        {
            var location = target.LocationInOthersSpace(AimingObject, _projectileSpeed);

            var angle = Vector3.Angle(location, Vector3.forward);

            return angle < ShootAngle;
        }
        return false;
    }

    public bool ShouldShoot()
    {
        return ShouldShoot(_targetChoosingMechanism.CurrentTarget);
    }
}
