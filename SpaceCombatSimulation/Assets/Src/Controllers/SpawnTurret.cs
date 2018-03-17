using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SpawnTurret : MonoBehaviour, IKnowsEnemyTags
{
    public TargetChoosingMechanism EnemyTagSource;
    public IKnowsEnemyTags _enemyTagSource;
    public bool TagChildren = false;

    public Transform ParentForTurret;


    #region EnemyTags
    public void AddEnemyTag(string newTag)
    {
        var tags = EnemyTags;
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    public List<string> KnownEnemyTags
    {
        get
        {
            return EnemyTags;
        }
        set
        {
            EnemyTags = value;
        }
    }

    public List<string> EnemyTags;
    #endregion

    public Transform TurretPrefab;

	// Use this for initialization
	void Start () {

        if(EnemyTagSource == null && transform.parent != null)
        {
            _enemyTagSource = transform.parent.GetComponent<IKnowsEnemyTags>();
        }
        else
        {
            _enemyTagSource = EnemyTagSource;
        }

        if(_enemyTagSource != null)
        {
            EnemyTags = _enemyTagSource.KnownEnemyTags;
        }

        if(ParentForTurret == null && transform.parent != null)
        {
            ParentForTurret = transform.parent;
        }

        var turret = Instantiate(TurretPrefab, transform.position, transform.rotation, ParentForTurret);

        if(ParentForTurret != null)
        {
            var parentRigidbody = ParentForTurret.GetComponent<Rigidbody>();
            if(parentRigidbody != null)
            {
                turret.SetVelocity(parentRigidbody.velocity);
            }

            turret.parent = ParentForTurret;
            turret.GetComponent<FixedJoint>().connectedBody = parentRigidbody;

            var renderer = ParentForTurret.GetComponent<Renderer>();

            if (renderer != null)
            {
                //Debug.Log("has renderer");
                turret.transform.SetColor(renderer.material.color);
            }
        }

        var tagKnower = turret.GetComponent<IKnowsEnemyTags>();
        if(tagKnower != null)
        {
            tagKnower.KnownEnemyTags = EnemyTags;
        }

        if (TagChildren) {
            turret.tag = tag;
        }


        Destroy(gameObject);
    }
}
